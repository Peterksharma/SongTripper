const { parseCoordinates } = require('../utils/geo');
const locationService = require('../services/locationService');
const ApiError = require('../utils/apiError');

/** GET /api/cities/lookup?lat=&lng= — reverse-geocode a coordinate pair. */
async function lookupCity(req, res, next) {
  try {
    const { lat, lng } = parseCoordinates(req.query.lat, req.query.lng);
    const place = await locationService.convertGpsToCity(lat, lng);
    if (!place.city) {
      throw new ApiError(404, 'No city found at these coordinates');
    }
    res.json(place);
  } catch (e) {
    next(e);
  }
}

module.exports = { lookupCity };
