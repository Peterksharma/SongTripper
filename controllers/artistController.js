const { parseCoordinates, parseLimit } = require('../utils/geo');
const locationService = require('../services/locationService');
const musicBrainz = require('../services/musicBrainzService');
const ApiError = require('../utils/apiError');

/**
 * GET /api/artists/by-location?lat=&lng=&limit= — the raw MusicBrainz view:
 * artists associated with the city at these coordinates, unranked, without
 * Spotify resolution. The curated, playable view lives at /api/songs.
 */
async function getArtistsByLocation(req, res, next) {
  try {
    const { lat, lng } = parseCoordinates(req.query.lat, req.query.lng);
    const limit = parseLimit(req.query.limit, { fallback: 25, max: 100 });

    const place = await locationService.convertGpsToCity(lat, lng);
    if (!place.city) {
      throw new ApiError(404, 'No city found at these coordinates');
    }
    const { areaId, areaName } = await musicBrainz.findCityArea(place.city, {
      state: place.state,
      country: place.country,
    });
    const { artists, artistCount } = await musicBrainz.getArtistsFromArea(areaId, limit);

    res.json({
      location: place,
      musicBrainzAreaId: areaId,
      areaName,
      artistCount,
      truncated: artists.length < artistCount,
      artists,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { getArtistsByLocation };
