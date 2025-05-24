const { convertGpsToCity } = require('../services/locationService');
const { getCityId, getArtistsByCityId } = require('../services/musicService');

async function getArtistsByLocation(req, res, next) {
  const { lat, lng, limit } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng query parameters are required' });
  }
  try {
    // Step 1: Get city info from GPS
    const data = await convertGpsToCity(lat, lng);
    const result = data.results && data.results[0];
    if (!result) return res.status(404).json({ error: 'No city found for coordinates' });
    const city = result.components.city || result.components.town || result.components.village || null;
    const state = result.components.state || null;
    if (!city) return res.status(404).json({ error: 'No city name found for coordinates' });
    // Step 2: Get MusicBrainz city ID
    const cityId = await getCityId(city, state);
    // Step 3: Get artists by city ID
    const artists = await getArtistsByCityId(cityId, limit ? parseInt(limit) : 10);
    res.json({ city, state, cityId, artists });
  } catch (e) {
    next(e);
  }
}

module.exports = { getArtistsByLocation };
