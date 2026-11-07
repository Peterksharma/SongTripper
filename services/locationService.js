const config = require('../config');
const ApiError = require('../utils/apiError');
const { getCache, setCache } = require('../utils/cache');
const { roundCoordinate } = require('../utils/geo');
const { upstreamFetch, readJson } = require('../utils/upstream');

/**
 * Reverse geocoding: GPS coordinates -> named place, via OpenCage.
 *
 * Coordinates are rounded onto the ~1.1 km cache grid (see utils/geo.js)
 * before both caching AND querying, so a moving vehicle's stream of nearby
 * readings resolves through one cache entry instead of one API call each.
 * Geography changes slowly; entries live for 30 days.
 */
const GEOCODE_TTL_SECONDS = 30 * 24 * 3600;

/**
 * convertGpsToCity(lat, lng) -> {
 *   city, state, country, countryCode, formatted
 * }
 * `city` is null when the point resolves to no populated place (open ocean,
 * wilderness); callers decide whether that is a 404.
 * Precondition: lat/lng already validated (utils/geo.parseCoordinates).
 */
async function convertGpsToCity(lat, lng) {
  if (!config.openCageKey) {
    throw new ApiError(503, 'Server is missing LOCATION_KEY (OpenCage) configuration');
  }
  const rlat = roundCoordinate(lat);
  const rlng = roundCoordinate(lng);
  const cacheKey = `geo:city:${rlat},${rlng}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const url = new URL('https://api.opencagedata.com/geocode/v1/json');
  url.searchParams.set('q', `${rlat},${rlng}`);
  url.searchParams.set('key', config.openCageKey);
  url.searchParams.set('no_annotations', '1');
  url.searchParams.set('limit', '1');

  const response = await upstreamFetch('OpenCage', url);
  if (!response.ok) {
    throw new ApiError(502, `Geocoding service error (${response.status})`);
  }
  const data = await readJson('OpenCage', response);
  const result = (data.results && data.results[0]) || null;
  const components = (result && result.components) || {};

  const place = {
    // OpenCage names the settlement at whichever granularity exists.
    city:
      components.city ||
      components.town ||
      components.village ||
      components.hamlet ||
      null,
    state: components.state || null,
    country: components.country || null,
    countryCode: components.country_code
      ? components.country_code.toUpperCase()
      : null,
    formatted: result ? result.formatted : null,
  };

  await setCache(cacheKey, place, GEOCODE_TTL_SECONDS);
  return place;
}

module.exports = { convertGpsToCity };
