jest.mock('../services/locationService');
jest.mock('../services/musicBrainzService');
jest.mock('../services/spotifyService');
jest.mock('../db/repository');
jest.mock('../utils/cache', () => ({
  getCache: jest.fn(async () => null),
  setCache: jest.fn(async () => {}),
}));

const location = require('../services/locationService');
const musicBrainz = require('../services/musicBrainzService');
const spotify = require('../services/spotifyService');
const repository = require('../db/repository');
const { getCache, setCache } = require('../utils/cache');
const ApiError = require('../utils/apiError');
const {
  getSongsByLocation,
  interleaveTracks,
  rankArtists,
} = require('../services/suggestionService');

const AUSTIN = {
  city: 'Austin',
  state: 'Texas',
  country: 'United States',
  countryCode: 'US',
  formatted: 'Austin, TX',
};

/** Default happy-path world; individual tests override pieces. */
function arrangeHappyPath() {
  location.convertGpsToCity.mockResolvedValue(AUSTIN);
  repository.findCity.mockResolvedValue(null);
  musicBrainz.findCityArea.mockResolvedValue({ areaId: 'area-1', areaName: 'Austin' });
  repository.upsertCity.mockResolvedValue({ id: 7, mb_area_id: 'area-1' });
  repository.getFreshCityArtists.mockResolvedValue(null);
  musicBrainz.getArtistsFromArea.mockResolvedValue({
    artists: [
      { mbId: 'mb-1', name: 'Linked One', type: 'Group', spotifyId: 'SP1' },
      { mbId: 'mb-2', name: 'Linked Two', type: 'Group', spotifyId: 'SP2' },
      { mbId: 'mb-3', name: 'Unlinked Three', type: 'Person', spotifyId: null },
    ],
    artistCount: 3,
  });
  spotify.enrichWithPopularity.mockImplementation(async (artists) =>
    artists.map((a, i) => ({ ...a, popularity: [50, 90][i] ?? 10, genres: [] }))
  );
  spotify.searchArtist.mockResolvedValue({
    spotifyId: 'SP3',
    name: 'Unlinked Three',
    popularity: 70,
    genres: ['indie'],
  });
  spotify.getTopTracks.mockImplementation(async (artist) => [
    { uri: `spotify:track:${artist.spotifyId}-1`, name: `${artist.name} hit 1` },
    { uri: `spotify:track:${artist.spotifyId}-2`, name: `${artist.name} hit 2` },
  ]);
  repository.saveCityArtists.mockResolvedValue();
  repository.updateArtistSpotify.mockResolvedValue();
}

describe('suggestionService.getSongsByLocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    arrangeHappyPath();
  });

  it('assembles the full pipeline: locate → area → roster → resolve → rank → deal', async () => {
    const payload = await getSongsByLocation(30.27, -97.74, 4);

    expect(payload.location).toEqual(AUSTIN);
    expect(payload.musicBrainzAreaId).toBe('area-1');
    // ranked by popularity: Linked Two (90), Unlinked Three (70), Linked One (50)
    expect(payload.artists.map((a) => a.name)).toEqual([
      'Linked Two',
      'Unlinked Three',
      'Linked One',
    ]);
    // round-robin: one track per artist in rank order, then seconds
    expect(payload.tracks.map((t) => t.uri)).toEqual([
      'spotify:track:SP2-1',
      'spotify:track:SP3-1',
      'spotify:track:SP1-1',
      'spotify:track:SP2-2',
    ]);
    // every track is annotated with its artist
    expect(payload.tracks[0].artist).toEqual({
      name: 'Linked Two',
      spotifyId: 'SP2',
      musicBrainzId: 'mb-2',
    });
    expect(setCache).toHaveBeenCalledWith(expect.stringContaining('songs:v1:30.27,-97.74:4'), payload, 24 * 3600);
    // roster and resolutions were persisted
    expect(repository.saveCityArtists).toHaveBeenCalledWith(7, expect.any(Array));
    expect(repository.updateArtistSpotify).toHaveBeenCalled();
  });

  it('serves a cached answer without touching any upstream', async () => {
    getCache.mockResolvedValueOnce({ cached: true });
    const payload = await getSongsByLocation(30.27, -97.74, 10);
    expect(payload).toEqual({ cached: true });
    expect(location.convertGpsToCity).not.toHaveBeenCalled();
  });

  it('uses a fresh roster from Postgres without calling MusicBrainz at all', async () => {
    repository.findCity.mockResolvedValue({ id: 3, mb_area_id: 'area-db' });
    repository.getFreshCityArtists.mockResolvedValue([
      { mbId: 'mb-9', name: 'DB Artist', spotifyId: 'SP9', popularity: 40, genres: [] },
    ]);
    const payload = await getSongsByLocation(30.27, -97.74, 5);
    expect(payload.musicBrainzAreaId).toBe('area-db');
    expect(musicBrainz.findCityArea).not.toHaveBeenCalled();
    expect(musicBrainz.getArtistsFromArea).not.toHaveBeenCalled();
  });

  it('still answers when Postgres is completely down', async () => {
    for (const fn of [
      repository.findCity,
      repository.upsertCity,
      repository.getFreshCityArtists,
      repository.saveCityArtists,
      repository.updateArtistSpotify,
    ]) {
      fn.mockRejectedValue(new Error('connection refused'));
    }
    const payload = await getSongsByLocation(30.27, -97.74, 4);
    expect(payload.tracks.length).toBeGreaterThan(0);
  });

  it('404s for coordinates that resolve to no city', async () => {
    location.convertGpsToCity.mockResolvedValue({ ...AUSTIN, city: null });
    await expect(getSongsByLocation(0, -140, 10)).rejects.toMatchObject({ status: 404 });
  });

  it('404s when MusicBrainz lists nobody for the city', async () => {
    musicBrainz.getArtistsFromArea.mockResolvedValue({ artists: [], artistCount: 0 });
    await expect(getSongsByLocation(30.27, -97.74, 10)).rejects.toMatchObject({ status: 404 });
  });

  it('404s when nothing resolves on Spotify', async () => {
    spotify.enrichWithPopularity.mockResolvedValue([]);
    spotify.searchArtist.mockResolvedValue(null);
    await expect(getSongsByLocation(30.27, -97.74, 10)).rejects.toMatchObject({ status: 404 });
  });

  it('404s when artists resolve but no tracks are playable', async () => {
    spotify.getTopTracks.mockResolvedValue([]);
    await expect(getSongsByLocation(30.27, -97.74, 10)).rejects.toMatchObject({ status: 404 });
  });

  it('survives individual top-track failures (one artist errors, others deliver)', async () => {
    spotify.getTopTracks
      .mockRejectedValueOnce(new Error('spotify hiccup'))
      .mockImplementation(async (artist) => [
        { uri: `spotify:track:${artist.spotifyId}-1`, name: 'x' },
      ]);
    const payload = await getSongsByLocation(30.27, -97.74, 10);
    expect(payload.tracks.length).toBeGreaterThan(0);
  });

  it('surfaces a full Spotify outage as the upstream error, not a 404 (top tracks)', async () => {
    const outage = new ApiError(502, 'Spotify is unreachable');
    spotify.getTopTracks.mockRejectedValue(outage);
    await expect(getSongsByLocation(30.27, -97.74, 10)).rejects.toMatchObject({
      status: 502,
      message: 'Spotify is unreachable',
    });
  });

  it('surfaces a full Spotify outage as the upstream error, not a 404 (search tier)', async () => {
    musicBrainz.getArtistsFromArea.mockResolvedValue({
      artists: [
        { mbId: 'mb-u1', name: 'Unlinked A', spotifyId: null },
        { mbId: 'mb-u2', name: 'Unlinked B', spotifyId: null },
      ],
      artistCount: 2,
    });
    spotify.enrichWithPopularity.mockResolvedValue([]);
    spotify.searchArtist.mockRejectedValue(new ApiError(503, 'Server is missing Spotify credentials'));
    await expect(getSongsByLocation(30.27, -97.74, 10)).rejects.toMatchObject({ status: 503 });
  });

  it('deduplicates two MusicBrainz artists resolving to one Spotify artist', async () => {
    musicBrainz.getArtistsFromArea.mockResolvedValue({
      artists: [
        { mbId: 'mb-a', name: 'Person', spotifyId: 'SAME' },
        { mbId: 'mb-b', name: 'Their Band', spotifyId: 'SAME' },
      ],
      artistCount: 2,
    });
    spotify.enrichWithPopularity.mockImplementation(async (artists) =>
      artists.map((a) => ({ ...a, popularity: 10, genres: [] }))
    );
    const payload = await getSongsByLocation(30.27, -97.74, 10);
    expect(payload.artists).toHaveLength(1);
  });
});

describe('interleaveTracks (round-robin dealing)', () => {
  const t = (uri) => ({ uri });

  it('deals one from each list per round', () => {
    const dealt = interleaveTracks([[t('a1'), t('a2')], [t('b1')], [t('c1'), t('c2')]], 10);
    expect(dealt.map((x) => x.uri)).toEqual(['a1', 'b1', 'c1', 'a2', 'c2']);
  });

  it('respects the limit mid-round', () => {
    const dealt = interleaveTracks([[t('a1'), t('a2')], [t('b1'), t('b2')]], 3);
    expect(dealt.map((x) => x.uri)).toEqual(['a1', 'b1', 'a2']);
  });

  it('deals a duplicate URI only once (collaborations)', () => {
    const dealt = interleaveTracks([[t('shared'), t('a2')], [t('shared'), t('b2')]], 10);
    expect(dealt.map((x) => x.uri)).toEqual(['shared', 'a2', 'b2']);
  });

  it('handles empty input', () => {
    expect(interleaveTracks([], 5)).toEqual([]);
    expect(interleaveTracks([[], []], 5)).toEqual([]);
  });
});

describe('rankArtists', () => {
  it('sorts by popularity descending', () => {
    const ranked = rankArtists([
      { name: 'mid', popularity: 50 },
      { name: 'top', popularity: 90 },
      { name: 'low', popularity: 10 },
    ]);
    expect(ranked.map((a) => a.name)).toEqual(['top', 'mid', 'low']);
  });

  it('preserves input (linked-first) order when popularity is unknown — the lite-mode ranking', () => {
    const ranked = rankArtists([
      { name: 'linked-1', popularity: null },
      { name: 'linked-2', popularity: null },
      { name: 'searched-1', popularity: null },
    ]);
    expect(ranked.map((a) => a.name)).toEqual(['linked-1', 'linked-2', 'searched-1']);
  });

  it('caps the list at ten artists', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `a${i}`, popularity: i }));
    expect(rankArtists(many)).toHaveLength(10);
  });
});
