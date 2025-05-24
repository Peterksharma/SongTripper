const { getCityId } = require('../services/musicService');

jest.mock('node-fetch', () => jest.fn());
const fetch = require('node-fetch');
const { getCache, setCache } = require('../utils/cache');

jest.mock('../utils/cache', () => ({
  getCache: jest.fn(() => null),
  setCache: jest.fn()
}));

describe('musicService', () => {
  it('throws error if no city found', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    await expect(getCityId('FakeCity')).rejects.toThrow('No city found for: FakeCity');
  });
});
