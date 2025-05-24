const { convertGpsToCity } = require('../services/locationService');

async function lookupCity(req, res, next) {
  const { lat, lng } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng query parameters are required' });
  }
  try {
    const data = await convertGpsToCity(lat, lng);
    // Extract city info from OpenCage response
    const result = data.results && data.results[0];
    if (!result) return res.status(404).json({ error: 'No city found for coordinates' });
    const city = result.components.city || result.components.town || result.components.village || null;
    const state = result.components.state || null;
    const country = result.components.country || null;
    res.json({ city, state, country, raw: result });
  } catch (e) {
    next(e);
  }
}

module.exports = { lookupCity };
