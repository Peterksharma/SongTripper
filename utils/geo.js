const ApiError = require('./apiError');

/**
 * Coordinate parsing and quantization.
 *
 * Cache keys must not use raw GPS coordinates: a moving vehicle reports a
 * slightly different position every time, so exact-coordinate keys would
 * never hit. We round to 2 decimal places (~1.1 km at the equator), which
 * makes nearby readings share cache entries while still resolving to the
 * same city — city extents are far larger than the grid cell.
 */
const COORD_DECIMALS = 2;

/**
 * Parse and validate lat/lng query values.
 * Precondition: raw values come straight from req.query (strings|undefined).
 * Postcondition: returns finite numbers with lat ∈ [-90, 90], lng ∈ [-180, 180].
 * Throws ApiError(400) otherwise.
 */
function parseCoordinates(latRaw, lngRaw) {
  if (latRaw === undefined || lngRaw === undefined || latRaw === '' || lngRaw === '') {
    throw new ApiError(400, 'lat and lng query parameters are required');
  }
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(400, 'lat and lng must be numbers');
  }
  if (lat < -90 || lat > 90) {
    throw new ApiError(400, 'lat must be between -90 and 90');
  }
  if (lng < -180 || lng > 180) {
    throw new ApiError(400, 'lng must be between -180 and 180');
  }
  return { lat, lng };
}

/**
 * Parse an optional result-count limit; defaults and clamps rather than
 * erroring on out-of-range values, but rejects non-numeric garbage.
 */
function parseLimit(raw, { fallback = 10, max = 50 } = {}) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new ApiError(400, 'limit must be an integer');
  }
  return Math.min(Math.max(n, 1), max);
}

/** Round one coordinate onto the cache grid. */
function roundCoordinate(value) {
  const factor = 10 ** COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Canonical cache-key fragment for a coordinate pair, e.g. "30.27,-97.74". */
function geoKey(lat, lng) {
  return `${roundCoordinate(lat)},${roundCoordinate(lng)}`;
}

module.exports = { parseCoordinates, parseLimit, roundCoordinate, geoKey };
