const { createClient } = require('redis');
const config = require('../config');

/**
 * Redis-backed cache that treats Redis as an optimization, never a
 * dependency: every operation degrades to a miss / no-op when Redis is
 * unreachable, so the API keeps answering (slower) with Redis down.
 *
 * Two guarantees make that true in practice:
 *  1. Bounded connection attempts — node-redis retries forever by default,
 *     which would leave connect() pending (and every request hanging on
 *     it). The reconnectStrategy below surfaces an Error after 3 attempts
 *     so connect() actually rejects and the cooldown engages.
 *  2. Bounded operations — each get/set races a short timeout, so even a
 *     wedged-but-connected Redis costs at most OP_TIMEOUT_MS per request
 *     before the cache disables itself.
 *
 * After any failure the cache disables itself for RETRY_COOLDOWN_MS: a
 * down Redis costs one failed attempt per cooldown window, not per request.
 */
const RETRY_COOLDOWN_MS = 30_000;
const CONNECT_TIMEOUT_MS = 2_000;
const CONNECT_BUDGET_MS = 4_000;
const OP_TIMEOUT_MS = 1_000;

let client = null;
let connecting = null;
let disabledUntil = 0;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      if (timer.unref) timer.unref();
    }),
  ]);
}

function disableCache(reason) {
  disabledUntil = Date.now() + RETRY_COOLDOWN_MS;
  console.warn(`Cache disabled for ${RETRY_COOLDOWN_MS / 1000}s: ${reason}`);
}

async function getClient() {
  if (Date.now() < disabledUntil) return null;
  if (client && client.isReady) return client;
  if (!connecting) {
    connecting = (async () => {
      try {
        if (!client) {
          client = createClient({
            url: config.redisUrl,
            // Fail fast instead of queueing commands while disconnected —
            // a hung cache must never hang an API request.
            disableOfflineQueue: true,
            socket: {
              connectTimeout: CONNECT_TIMEOUT_MS,
              // Returning an Error stops reconnection and rejects the
              // pending connect(); without this, node-redis retries
              // forever and connect() never settles.
              reconnectStrategy: (retries) =>
                retries >= 3 ? new Error('Redis unreachable') : Math.min(retries * 100, 500),
            },
          });
          // Errors surface per-operation; without a listener the client
          // would emit an uncaught 'error' event and crash the process.
          client.on('error', () => {});
        }
        if (!client.isOpen) {
          await withTimeout(client.connect(), CONNECT_BUDGET_MS, 'Redis connect');
        }
        return client;
      } catch (e) {
        disableCache(e.message);
        // Discard the failed client; a fresh one is built next attempt.
        const failed = client;
        client = null;
        if (failed) {
          Promise.resolve()
            .then(() => (failed.destroy ? failed.destroy() : failed.disconnect()))
            .catch(() => {});
        }
        return null;
      } finally {
        connecting = null;
      }
    })();
  }
  return connecting;
}

/** Fetch a JSON value; returns null on miss, corrupt entry, or Redis trouble. */
async function getCache(key) {
  let c;
  try {
    c = await getClient();
  } catch {
    return null;
  }
  if (!c) return null;
  let raw;
  try {
    raw = await withTimeout(c.get(key), OP_TIMEOUT_MS, 'Redis GET');
  } catch (e) {
    disableCache(e.message);
    return null;
  }
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupt entry is a miss, not an outage
  }
}

/** Store a JSON value with a TTL; silently a no-op on Redis trouble. */
async function setCache(key, value, ttlSeconds = 3600) {
  let c;
  try {
    c = await getClient();
  } catch {
    return;
  }
  if (!c) return;
  try {
    await withTimeout(c.set(key, JSON.stringify(value), { EX: ttlSeconds }), OP_TIMEOUT_MS, 'Redis SET');
  } catch (e) {
    disableCache(e.message);
  }
}

/** Graceful-shutdown hook. */
async function closeCache() {
  if (client && client.isOpen) {
    await client.quit().catch(() => {});
  }
  client = null;
}

module.exports = { getCache, setCache, closeCache };
