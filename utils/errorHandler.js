/**
 * Final Express error handler: map an error to a JSON response.
 *
 * Errors with an integer `status` (see ApiError) chose their own HTTP status
 * and their message is safe to show. Everything else is an unexpected
 * programming error: log it fully, answer 500 with a generic message so
 * internals never leak to clients.
 */
function errorHandler(err, req, res, next) {
  const status = Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
  }
  const message = status === 500 ? 'Internal Server Error' : err.message;
  res.status(status).json({ error: message });
}

module.exports = errorHandler;
