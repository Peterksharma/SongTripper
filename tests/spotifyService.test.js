process.env.SPOTIFY_CLIENT_ID = 'test-client';
process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';

const ID_A = 'A'.repeat(22);
const ID_B = 'B'.repeat(22);

const jsonResponse = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
});
const tokenResponse = () => jsonResponse({ access_token: 'tok', expires_in: 3600 });

/** Route fetch calls by URL; unrouted paths fail the test loudly. */
function routeFetch(routes) {
  global.fetch = jest.fn(async (input) => {
    const url = String(input);
    for (const [match, responder] of routes) {
      if (url.includes(match)) return responder(url);
    }
    throw new Error(`unrouted fetch in test: ${url}`);
  });
}

const apiCalls = (fragment) =>
  fetch.mock.calls.filter(([u]) => String(u).includes(fragment)).length;

describe('spotifyService', () => {
  let spotify;

  beforeEach(() => {
    jest.resetModules();
    spotify = require('../services/spotifyService');
    spotify.resetForTests();
  });
  afterEach(() => {
    delete global.fetch;
  });

  it('memoizes the app token across calls', async () => {
    routeFetch([
      ['accounts.spotify.com', tokenResponse],
      ['/v1/search', () => jsonResponse({ artists: { items: [] } })],
    ]);
    await spotify.searchArtist('One');
    await spotify.searchArtist('Two');
    expect(apiCalls('accounts.spotify.com')).toBe(1);
  });

  it('fails with 503 when credentials are missing', async () => {
    const saved = process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_ID;
    let fresh;
    jest.isolateModules(() => {
      fresh = require('../services/spotifyService');
    });
    process.env.SPOTIFY_CLIENT_ID = saved;
    await expect(fresh.searchArtist('X')).rejects.toMatchObject({ status: 503 });
  });

  describe('searchArtist', () => {
    it('accepts only exact normalized name matches, preferring popularity', async () => {
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        [
          '/v1/search',
          () =>
            jsonResponse({
              artists: {
                items: [
                  { id: ID_A, name: 'The  Midnight', popularity: 40, genres: ['a'] },
                  { id: ID_B, name: 'The Midnight', popularity: 70, genres: ['b'] },
                  { id: 'other', name: 'Midnight Riders', popularity: 99, genres: [] },
                ],
              },
            }),
        ],
      ]);
      const hit = await spotify.searchArtist('The Midnight');
      expect(hit).toEqual({ spotifyId: ID_B, name: 'The Midnight', popularity: 70, genres: ['b'] });
    });

    it('returns null rather than a wrong same-named artist', async () => {
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        [
          '/v1/search',
          () => jsonResponse({ artists: { items: [{ id: 'x', name: 'Completely Different' }] } }),
        ],
      ]);
      expect(await spotify.searchArtist('Obscure Local Band')).toBeNull();
    });
  });

  describe('enrichWithPopularity', () => {
    const input = [
      { mbId: 'mb-1', name: 'MB Name A', spotifyId: ID_A },
      { mbId: 'mb-2', name: 'MB Name B', spotifyId: ID_B },
    ];

    it('uses the batch endpoint and drops dead links', async () => {
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        [
          '/v1/artists?',
          () =>
            jsonResponse({
              artists: [{ id: ID_A, name: 'Canonical A', popularity: 61, genres: ['g'] }, null],
            }),
        ],
      ]);
      const enriched = await spotify.enrichWithPopularity(input);
      expect(enriched).toEqual([
        { mbId: 'mb-1', name: 'Canonical A', spotifyId: ID_A, popularity: 61, genres: ['g'] },
      ]);
    });

    it('degrades to null popularity when the batch endpoint is gone (403), and remembers', async () => {
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        ['/v1/artists?', () => jsonResponse({ error: 'gone' }, 403)],
      ]);
      const first = await spotify.enrichWithPopularity(input);
      expect(first).toEqual([
        { mbId: 'mb-1', name: 'MB Name A', spotifyId: ID_A, popularity: null, genres: [] },
        { mbId: 'mb-2', name: 'MB Name B', spotifyId: ID_B, popularity: null, genres: [] },
      ]);
      await spotify.enrichWithPopularity(input);
      expect(apiCalls('/v1/artists?')).toBe(1); // second call never re-tries the dead endpoint
    });

    it('preserves popularity/genres already known (e.g. from Postgres) in lite mode', async () => {
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        ['/v1/artists?', () => jsonResponse({ error: 'gone' }, 403)],
      ]);
      const stored = [
        { mbId: 'mb-1', name: 'Once Ranked', spotifyId: ID_A, popularity: 90, genres: ['g'] },
        { mbId: 'mb-2', name: 'Never Ranked', spotifyId: ID_B },
      ];
      await spotify.enrichWithPopularity(stored); // flips to lite via 403
      const enriched = await spotify.enrichWithPopularity(stored);
      expect(enriched[0].popularity).toBe(90);
      expect(enriched[0].genres).toEqual(['g']);
      expect(enriched[1].popularity).toBeNull();
    });

    it('propagates real upstream failures (500)', async () => {
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        ['/v1/artists?', () => jsonResponse({}, 500)],
      ]);
      await expect(spotify.enrichWithPopularity(input)).rejects.toMatchObject({ status: 502 });
    });
  });

  describe('getTopTracks', () => {
    const artist = { spotifyId: ID_A, name: 'Local Hero' };
    const richTrack = {
      id: 't1',
      uri: 'spotify:track:t1',
      name: 'Anthem',
      album: { name: 'LP', images: [{ url: 'http://img' }] },
      duration_ms: 200000,
      popularity: 55,
      preview_url: null,
      explicit: false,
    };

    it('uses the dedicated endpoint with a required market', async () => {
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        [`/v1/artists/${ID_A}/top-tracks`, () => jsonResponse({ tracks: [richTrack] })],
      ]);
      const tracks = await spotify.getTopTracks(artist, 'US');
      expect(tracks).toEqual([
        {
          spotifyTrackId: 't1',
          uri: 'spotify:track:t1',
          name: 'Anthem',
          album: 'LP',
          albumImage: 'http://img',
          durationMs: 200000,
          popularity: 55,
          previewUrl: null,
          explicit: false,
        },
      ]);
      expect(String(fetch.mock.calls.at(-1)[0])).toContain('market=US');
    });

    it('falls back to identity-filtered track search when the endpoint is gone (403)', async () => {
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        ['/top-tracks', () => jsonResponse({}, 403)],
        [
          '/v1/search',
          () =>
            jsonResponse({
              tracks: {
                items: [
                  { id: 'w', uri: 'u:w', name: 'Wrong Artist Song', popularity: 90, artists: [{ id: 'someone-else' }] },
                  { id: 'r1', uri: 'u:r1', name: 'Right Song', popularity: 40, artists: [{ id: ID_A }] },
                  { id: 'r2', uri: 'u:r2', name: 'Bigger Song', popularity: 80, artists: [{ id: ID_A }] },
                ],
              },
            }),
        ],
      ]);
      const tracks = await spotify.getTopTracks(artist, 'US');
      // wrong-artist track excluded; remaining sorted by popularity
      expect(tracks.map((t) => t.spotifyTrackId)).toEqual(['r2', 'r1']);

      // The 403 flipped the strategy: the next call skips the rich endpoint.
      await spotify.getTopTracks(artist, 'US');
      expect(apiCalls('/top-tracks')).toBe(1);
    });

    it('tolerates isolated 404s (dead artist id) without abandoning the rich endpoint', async () => {
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        ['/top-tracks', () => jsonResponse({}, 404)],
        ['/v1/search', () => jsonResponse({ tracks: { items: [] } })],
      ]);
      await spotify.getTopTracks(artist, 'US');
      await spotify.getTopTracks(artist, 'US');
      expect(apiCalls('/top-tracks')).toBe(2); // still trying after one-off 404s
    });

    it('abandons the rich endpoint after repeated 404s', async () => {
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        ['/top-tracks', () => jsonResponse({}, 404)],
        ['/v1/search', () => jsonResponse({ tracks: { items: [] } })],
      ]);
      await spotify.getTopTracks(artist, 'US');
      await spotify.getTopTracks(artist, 'US');
      await spotify.getTopTracks(artist, 'US');
      await spotify.getTopTracks(artist, 'US');
      expect(apiCalls('/top-tracks')).toBe(3); // fourth call went straight to search
    });
  });

  describe('retries', () => {
    it('refreshes the token once on 401', async () => {
      let apiHits = 0;
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        [
          '/v1/search',
          () => (apiHits++ === 0 ? jsonResponse({}, 401) : jsonResponse({ artists: { items: [] } })),
        ],
      ]);
      expect(await spotify.searchArtist('X')).toBeNull();
      expect(apiCalls('accounts.spotify.com')).toBe(2);
    });

    it('honors a short Retry-After on 429', async () => {
      jest.useFakeTimers();
      let apiHits = 0;
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        [
          '/v1/search',
          () =>
            apiHits++ === 0
              ? jsonResponse({}, 429, { 'retry-after': '2' })
              : jsonResponse({ artists: { items: [] } }),
        ],
      ]);
      const promise = spotify.searchArtist('X');
      await jest.advanceTimersByTimeAsync(4000);
      expect(await promise).toBeNull();
      expect(apiHits).toBe(2);
      jest.useRealTimers();
    });

    it('surfaces a long rate-limit lockout as 503 instead of hanging', async () => {
      routeFetch([
        ['accounts.spotify.com', tokenResponse],
        ['/v1/search', () => jsonResponse({}, 429, { 'retry-after': '600' })],
      ]);
      await expect(spotify.searchArtist('X')).rejects.toMatchObject({ status: 503 });
    });
  });
});
