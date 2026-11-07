const { parseCoordinates, parseLimit } = require('../utils/geo');
const suggestionService = require('../services/suggestionService');

/**
 * GET /api/songs/by-location?lat=&lng=&limit= — the flagship endpoint:
 * playable Spotify tracks by artists from wherever the coordinates land.
 * All the work happens in services/suggestionService.js; this controller
 * only validates input and shapes the HTTP exchange.
 */
async function getSongsByLocation(req, res, next) {
  try {
    const { lat, lng } = parseCoordinates(req.query.lat, req.query.lng);
    const limit = parseLimit(req.query.limit, { fallback: 10, max: 50 });
    const payload = await suggestionService.getSongsByLocation(lat, lng, limit);
    res.json(payload);
  } catch (e) {
    next(e);
  }
}

module.exports = { getSongsByLocation };
