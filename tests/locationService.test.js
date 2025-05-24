const { convertGpsToCity } = require('../services/locationService');

describe('locationService', () => {
  it('throws error if LOCATION_KEY is not set', async () => {
    const original = process.env.LOCATION_KEY;
    process.env.LOCATION_KEY = '';
    await expect(convertGpsToCity(30, -97)).rejects.toThrow('LOCATION_KEY is not set');
    process.env.LOCATION_KEY = original;
  });
});
