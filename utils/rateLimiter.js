/**
 * Inbound per-client limiter: one request per second per IP.
 *
 * This protects the server from a chatty client; the MusicBrainz 1-req/sec
 * etiquette is enforced separately by the outbound serial throttle
 * (utils/throttle.js), which is the one that actually matters for upstream
 * compliance.
 *
 * Fixed-window algorithm: remember each IP's last accepted request time;
 * accept iff at least WINDOW_MS have passed. A periodic sweep evicts stale
 * entries so the map's size stays proportional to *active* clients.
 */
const WINDOW_MS = 1000;
const SWEEP_INTERVAL_MS = 60_000;

const lastAccepted = new Map();

function rateLimiter(req, res, next) {
  // req.ip is only the real client when app.js's trust-proxy setting
  // matches the deployment; fall back rather than key everyone on undefined.
  const ip = req.ip ?? (req.socket && req.socket.remoteAddress) ?? 'unknown';
  const now = Date.now();
  const previous = lastAccepted.get(ip);
  if (previous === undefined || now - previous > WINDOW_MS) {
    lastAccepted.set(ip, now);
    return next();
  }
  res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
}

const sweeper = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [ip, time] of lastAccepted) {
    if (time < cutoff) lastAccepted.delete(ip);
  }
}, SWEEP_INTERVAL_MS);
sweeper.unref(); // never keep the process alive just to sweep

module.exports = rateLimiter;
