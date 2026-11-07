jest.mock('../utils/cache', () => ({
  getCache: jest.fn(async () => null),
  setCache: jest.fn(async () => {}),
}));

process.env.LOCATION_KEY = 'test-key';

const { getCache, setCache } = require('../utils/cache');
const { convertGpsToCity } = require('../services/locationService');

const openCageResponse = (components, formatted = 'somewhere') => ({
  ok: true,
  status: 200,
  json: async () => ({ results: [{ components, formatted }] }),
});

describe('locationService.convertGpsToCity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });
  afterEach(() => {
    delete global.fetch;
  });

  it('normalizes an OpenCage result and caches it under the rounded-grid key', async () => {
    fetch.mockResolvedValue(
      openCageResponse(
        { city: 'Austin', state: 'Texas', country: 'United States', country_code: 'us' },
        'Austin, TX, United States'
      )
    );
    const place = await convertGpsToCity(30.2671, -97.7431);

    expect(place).toEqual({
      city: 'Austin',
      state: 'Texas',
      country: 'United States',
      countryCode: 'US',
      formatted: 'Austin, TX, United States',
    });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get('q')).toBe('30.27,-97.74');
    expect(url.searchParams.get('key')).toBe('test-key');
    expect(setCache).toHaveBeenCalledWith('geo:city:30.27,-97.74', place, 30 * 24 * 3600);
  });

  it('falls back through town/village/hamlet for smaller places', async () => {
    fetch.mockResolvedValue(openCageResponse({ town: 'Marfa', state: 'Texas' }));
    expect((await convertGpsToCity(30.31, -104.02)).city).toBe('Marfa');

    fetch.mockResolvedValue(openCageResponse({ village: 'Luckenbach' }));
    expect((await convertGpsToCity(30.17, -98.74)).city).toBe('Luckenbach');
  });

  it('returns city: null when the point resolves to nothing (open ocean)', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) });
    const place = await convertGpsToCity(0, -140);
    expect(place.city).toBeNull();
    expect(place.country).toBeNull();
  });

  it('serves from cache without calling OpenCage', async () => {
    getCache.mockResolvedValueOnce({ city: 'Cached City' });
    const place = await convertGpsToCity(30, -97);
    expect(place.city).toBe('Cached City');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps an upstream failure to a 502', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(convertGpsToCity(30, -97)).rejects.toMatchObject({ status: 502 });
  });

  it('fails with 503 when the API key is not configured', async () => {
    const saved = process.env.LOCATION_KEY;
    delete process.env.LOCATION_KEY;
    let freshService;
    jest.isolateModules(() => {
      freshService = require('../services/locationService');
    });
    process.env.LOCATION_KEY = saved;
    await expect(freshService.convertGpsToCity(30, -97)).rejects.toMatchObject({
      status: 503,
    });
  });
});
