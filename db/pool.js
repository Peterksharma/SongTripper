const { Pool } = require('pg');
const config = require('../config');

/**
 * Lazily-created singleton Postgres pool.
 *
 * With DATABASE_URL set, it wins. Without it, the pg driver's defaults
 * apply (local socket / localhost, current OS user) plus our database name —
 * which matches a stock Homebrew Postgres with trust auth.
 *
 * Callers must treat every query as fallible: the suggestion pipeline
 * wraps persistence in best-effort guards so a down Postgres degrades the
 * service (no memory between restarts) instead of breaking it.
 */
let pool = null;

function getPool() {
  if (!pool) {
    // Bounded waits: a stalled Postgres must degrade requests (best-effort
    // callers catch these errors), never hang them.
    const bounds = { connectionTimeoutMillis: 3000, query_timeout: 5000 };
    pool = new Pool(
      config.databaseUrl
        ? { connectionString: config.databaseUrl, ...bounds }
        : { database: config.databaseName, ...bounds }
    );
    // An idle client dropping its connection emits 'error' on the pool;
    // without a listener that would crash the process.
    pool.on('error', (err) => {
      console.warn('Postgres pool error:', err.message);
    });
  }
  return pool;
}

/** Graceful-shutdown hook. */
async function closePool() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}

module.exports = { getPool, closePool };
