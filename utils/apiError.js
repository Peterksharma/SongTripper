/**
 * An Error carrying the HTTP status the API should answer with.
 *
 * Services throw ApiError when a failure has a meaningful client-facing
 * status (400 bad input, 404 nothing found, 502 upstream broke, 503 server
 * misconfigured). Anything else that escapes is a programming error and the
 * error handler reports it as a 500.
 */
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

module.exports = ApiError;
