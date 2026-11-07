jest.mock('../services/locationService');
jest.mock('../services/musicBrainzService');
jest.mock('../services/suggestionService');
// The per-IP limiter would 429 supertest's rapid-fire requests; it has its
// own unit test (rateLimiter.test.js).
jest.mock('../utils/rateLimiter', () => (req, res, next) => next());

const request = require('supertest');
const app = require('../app');
const location = require('../services/locationService');
const musicBrainz = require('../services/musicBrainzService');
const suggestions = require('../services/suggestionService');
const ApiError = require('../utils/apiError');

const AUSTIN = {
  city: 'Austin',
  state: 'Texas',
  country: 'United States',
  countryCode: 'US',
  formatted: 'Austin, TX',
};

describe('the assembled app (HTTP contract)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/health answers ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('unknown routes answer JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  describe('GET /api/songs/by-location', () => {
    it('validates coordinates before doing any work', async () => {
      for (const qs of ['', 'lat=30.27', 'lat=abc&lng=-97', 'lat=91&lng=0', 'lat=0&lng=200']) {
        const res = await request(app).get(`/api/songs/by-location?${qs}`);
        expect(res.status).toBe(400);
      }
      expect(suggestions.getSongsByLocation).not.toHaveBeenCalled();
    });

    it('passes validated input through and returns the payload', async () => {
      const payload = { location: AUSTIN, tracks: [{ uri: 'spotify:track:x' }] };
      suggestions.getSongsByLocation.mockResolvedValue(payload);

      const res = await request(app).get('/api/songs/by-location?lat=30.267&lng=-97.743&limit=5');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(payload);
      expect(suggestions.getSongsByLocation).toHaveBeenCalledWith(30.267, -97.743, 5);
    });

    it('maps ApiError status through to the response', async () => {
      suggestions.getSongsByLocation.mockRejectedValue(
        new ApiError(404, 'No city found at these coordinates')
      );
      const res = await request(app).get('/api/songs/by-location?lat=0&lng=-140');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No city found at these coordinates');
    });

    it('hides internal error details behind a generic 500', async () => {
      suggestions.getSongsByLocation.mockRejectedValue(new Error('pg password leaked'));
      const res = await request(app).get('/api/songs/by-location?lat=1&lng=1');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /api/cities/lookup', () => {
    it('returns the normalized place', async () => {
      location.convertGpsToCity.mockResolvedValue(AUSTIN);
      const res = await request(app).get('/api/cities/lookup?lat=30.267&lng=-97.743');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(AUSTIN);
    });

    it('404s in the middle of the ocean', async () => {
      location.convertGpsToCity.mockResolvedValue({ ...AUSTIN, city: null });
      const res = await request(app).get('/api/cities/lookup?lat=0&lng=-140');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/artists/by-location', () => {
    it('returns the raw MusicBrainz view', async () => {
      location.convertGpsToCity.mockResolvedValue(AUSTIN);
      musicBrainz.findCityArea.mockResolvedValue({ areaId: 'area-1', areaName: 'Austin' });
      musicBrainz.getArtistsFromArea.mockResolvedValue({
        artists: [{ mbId: 'mb-1', name: 'Local Band', type: 'Group', spotifyId: null }],
        artistCount: 4144,
      });

      const res = await request(app).get('/api/artists/by-location?lat=30.267&lng=-97.743&limit=50');
      expect(res.status).toBe(200);
      expect(res.body.musicBrainzAreaId).toBe('area-1');
      expect(res.body.artists).toHaveLength(1);
      expect(res.body.artistCount).toBe(4144);
      expect(res.body.truncated).toBe(true);
      expect(musicBrainz.getArtistsFromArea).toHaveBeenCalledWith('area-1', 50);
    });

    it('validates input', async () => {
      const res = await request(app).get('/api/artists/by-location?lat=abc&lng=1');
      expect(res.status).toBe(400);
    });
  });
});
