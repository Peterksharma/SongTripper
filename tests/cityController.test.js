const { lookupCity } = require('../controllers/cityController');

describe('cityController', () => {
  it('returns 400 if lat/lng are missing', async () => {
    const req = { query: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await lookupCity(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'lat and lng query parameters are required' });
  });
});
