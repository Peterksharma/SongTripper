// Simple in-memory rate limiter (per IP, 1 req/sec)
const rateLimitWindowMs = 1000; // 1 second
const ipTimestamps = {};

function rateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  if (!ipTimestamps[ip] || now - ipTimestamps[ip] > rateLimitWindowMs) {
    ipTimestamps[ip] = now;
    return next();
  }
  res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
}

module.exports = rateLimiter;
