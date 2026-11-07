jest.mock('../utils/cache', () => ({
  getCache: jest.fn(async () => null),
  setCache: jest.fn(async () => {}),
}));

process.env.EMAIL = 'test@example.com';

const SPOTIFY_ID = '0OdUWJ0sBjDrqHygGUXeCF'; // 22 base-62 chars

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Fake timers drive the throttle; flush generously before awaiting. */
async function settle(promise) {
  await jest.advanceTimersByTimeAsync(60_000);
  return promise;
}

describe('musicBrainzService', () => {
  let mb;

  beforeEach(() => {
    jest.resetModules(); // fresh throttle state per test
    jest.clearAllMocks();
    jest.useFakeTimers();
    global.fetch = jest.fn();
    mb = require('../services/musicBrainzService');
  });
  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  describe('findCityArea', () => {
    it('takes the first City-typed hit (highest MusicBrainz score)', async () => {
      fetch.mockResolvedValue(
        jsonResponse({
          areas: [
            { id: 'x1', type: 'Subdivision', name: 'Austin County' },
            { id: 'austin-tx', type: 'City', name: 'Austin' },
            { id: 'austin-mn', type: 'City', name: 'Austin' },
          ],
        })
      );
      const area = await settle(mb.findCityArea('Austin'));
      expect(area).toEqual({ areaId: 'austin-tx', areaName: 'Austin' });

      const url = new URL(fetch.mock.calls[0][0]);
      expect(url.pathname).toBe('/ws/2/area');
      expect(url.searchParams.get('query')).toBe('"Austin" AND type:City');
      expect(url.searchParams.get('fmt')).toBe('json');
      expect(fetch.mock.calls[0][1].headers['User-Agent']).toContain('test@example.com');
    });

    it('404s when MusicBrainz knows no such city', async () => {
      fetch.mockResolvedValue(jsonResponse({ areas: [] }));
      // attach the rejection handler before advancing timers
      const expectation = expect(mb.findCityArea('Nowhereville')).rejects.toMatchObject({
        status: 404,
      });
      await jest.advanceTimersByTimeAsync(60_000);
      await expectation;
    });

    it('escapes Lucene syntax in city names', async () => {
      fetch.mockResolvedValue(
        jsonResponse({ areas: [{ id: 'a', type: 'City', name: 'Wilkes-Barre' }] })
      );
      await settle(mb.findCityArea('Wilkes-Barre'));
      const url = new URL(fetch.mock.calls[0][0]);
      expect(url.searchParams.get('query')).toBe('"Wilkes\\-Barre" AND type:City');
    });

    it('disambiguates same-named cities by walking parent areas toward the state', async () => {
      const partOf = (parentId, parentName) =>
        jsonResponse({
          relations: [
            { type: 'part of', direction: 'backward', area: { id: parentId, name: parentName } },
          ],
        });
      fetch.mockImplementation(async (input) => {
        const url = new URL(input);
        if (url.pathname === '/ws/2/area') {
          return jsonResponse({
            areas: [
              { id: 'springfield-ma', type: 'City', name: 'Springfield' },
              { id: 'springfield-mo', type: 'City', name: 'Springfield' },
            ],
          });
        }
        // parent-chain lookups: city → county → state
        if (url.pathname.endsWith('/springfield-ma')) return partOf('hampden-county', 'Hampden County');
        if (url.pathname.endsWith('/hampden-county')) return partOf('massachusetts', 'Massachusetts');
        if (url.pathname.endsWith('/springfield-mo')) return partOf('greene-county', 'Greene County');
        if (url.pathname.endsWith('/greene-county')) return partOf('missouri', 'Missouri');
        return jsonResponse({ relations: [] });
      });

      const area = await settle(
        mb.findCityArea('Springfield', { state: 'Missouri', country: 'United States' })
      );
      expect(area.areaId).toBe('springfield-mo');
    });

    it('falls back to the top hit when no state is available to verify against', async () => {
      fetch.mockResolvedValue(
        jsonResponse({
          areas: [
            { id: 'springfield-ma', type: 'City', name: 'Springfield' },
            { id: 'springfield-mo', type: 'City', name: 'Springfield' },
          ],
        })
      );
      const area = await settle(mb.findCityArea('Springfield'));
      expect(area.areaId).toBe('springfield-ma');
      expect(fetch).toHaveBeenCalledTimes(1); // no verification lookups spent
    });
  });

  describe('getArtistsFromArea', () => {
    it('maps artists, lifts Spotify ids from URL relations, and reports the true total', async () => {
      fetch.mockResolvedValue(
        jsonResponse({
          'artist-count': 2,
          artists: [
            {
              id: 'mb-1',
              name: 'Linked Band',
              type: 'Group',
              relations: [
                { url: { resource: 'https://linkedband.bandcamp.com/' } },
                { url: { resource: `https://open.spotify.com/artist/${SPOTIFY_ID}` } },
              ],
            },
            { id: 'mb-2', name: 'Obscure Solo', type: 'Person', relations: [] },
          ],
        })
      );
      const { artists, artistCount } = await settle(mb.getArtistsFromArea('area-1', 100));
      expect(artistCount).toBe(2);
      expect(artists).toEqual([
        { mbId: 'mb-1', name: 'Linked Band', type: 'Group', spotifyId: SPOTIFY_ID },
        { mbId: 'mb-2', name: 'Obscure Solo', type: 'Person', spotifyId: null },
      ]);

      const url = new URL(fetch.mock.calls[0][0]);
      expect(url.searchParams.get('area')).toBe('area-1');
      expect(url.searchParams.get('inc')).toBe('url-rels');
      expect(url.searchParams.get('limit')).toBe('100');
      expect(fetch).toHaveBeenCalledTimes(1); // total covered by one page — no extra calls
    });

    it('pages the browse up to maxArtists for big cities', async () => {
      const page = (offset) => ({
        'artist-count': 250,
        artists: Array.from({ length: Math.min(100, 250 - offset) }, (_, i) => ({
          id: `mb-${offset + i}`,
          name: `Artist ${offset + i}`,
          type: 'Group',
          relations: [],
        })),
      });
      fetch.mockImplementation(async (input) => {
        const offset = Number(new URL(input).searchParams.get('offset') || 0);
        return jsonResponse(page(offset));
      });

      const { artists, artistCount } = await settle(mb.getArtistsFromArea('big-city', 300));
      expect(artistCount).toBe(250);
      expect(artists).toHaveLength(250);
      expect(fetch).toHaveBeenCalledTimes(3);
      const offsets = fetch.mock.calls.map(([u]) => new URL(u).searchParams.get('offset'));
      expect(offsets).toEqual(['0', '100', '200']);
    });
  });

  describe('extractSpotifyId', () => {
    it('requires exactly 22 base-62 characters', () => {
      expect(
        mb.extractSpotifyId([{ url: { resource: 'https://open.spotify.com/artist/short' } }])
      ).toBeNull();
      expect(
        mb.extractSpotifyId([
          { url: { resource: `https://open.spotify.com/artist/${SPOTIFY_ID}?si=xyz` } },
        ])
      ).toBe(SPOTIFY_ID);
    });

    it('ignores non-Spotify and malformed relations', () => {
      expect(mb.extractSpotifyId(undefined)).toBeNull();
      expect(mb.extractSpotifyId([{ url: { resource: 'https://example.com' } }, {}])).toBeNull();
    });
  });

  describe('throttling and 503 handling', () => {
    it('spaces consecutive requests at least 1.1s apart', async () => {
      const callTimes = [];
      fetch.mockImplementation(async () => {
        callTimes.push(Date.now());
        return jsonResponse({ areas: [{ id: 'a', type: 'City', name: 'X' }] });
      });
      await settle(Promise.all([mb.findCityArea('One'), mb.findCityArea('Two')]));
      expect(callTimes).toHaveLength(2);
      expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(1100);
    });

    it('retries once after a 503 (their throttle signal)', async () => {
      fetch
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValueOnce(jsonResponse({ areas: [{ id: 'a', type: 'City', name: 'X' }] }));
      const area = await settle(mb.findCityArea('Austin'));
      expect(area.areaId).toBe('a');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('gives up with a 502 when the retry also fails', async () => {
      fetch.mockResolvedValue(jsonResponse({}, 503));
      const expectation = expect(mb.findCityArea('Austin')).rejects.toMatchObject({
        status: 502,
      });
      await jest.advanceTimersByTimeAsync(60_000);
      await expectation;
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
