const ApiError = require('./apiError');

/**
 * Outbound HTTP with a hard time budget.
 *
 * Every upstream call must be bounded: an unanswered socket would otherwise
 * hold an API request open indefinitely — and for MusicBrainz, whose calls
 * flow through a serial throttle, one hung response would stall every
 * queued request behind it.
 *
 * Transport-level failures (timeout, DNS, connection reset) are mapped to
 * gateway-style ApiErrors here so they reach clients as honest 502/504s
 * instead of anonymous 500s.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

async function upstreamFetch(serviceName, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  try {
    // A fresh signal per call: a shared signal's clock would start at
    // creation time and shortchange retries.
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new ApiError(504, `${serviceName} timed out`);
    }
    throw new ApiError(502, `${serviceName} is unreachable`);
  }
}

/** Parse a JSON body, mapping a malformed payload to a 502. */
async function readJson(serviceName, response) {
  try {
    return await response.json();
  } catch {
    throw new ApiError(502, `${serviceName} returned malformed JSON`);
  }
}

module.exports = { upstreamFetch, readJson, DEFAULT_TIMEOUT_MS };
