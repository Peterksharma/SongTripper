const app = require('./app');
const config = require('./config');
const { closeCache } = require('./utils/cache');
const { closePool } = require('./db/pool');

const server = app.listen(config.port, () => {
  console.log(`SongTripper API listening on port ${config.port}`);
});

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests
 * drain, close Redis and Postgres, exit. A watchdog force-exits after 10s
 * so a wedged connection can't keep the process alive forever.
 */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down`);
  const watchdog = setTimeout(() => process.exit(1), 10_000);
  watchdog.unref();
  server.close(async () => {
    await closeCache();
    await closePool();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
