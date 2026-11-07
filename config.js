require('dotenv').config();

/**
 * Central configuration, read from the environment exactly once at startup.
 *
 * Required keys are validated lazily by the services that need them (each
 * throws a clear 503 if its key is absent), so the server can boot — and
 * endpoints that don't need a given key keep working — with a partial .env.
 */
const contactEmail = process.env.EMAIL || 'unknown@example.com';

const config = {
  port: Number.parseInt(process.env.PORT, 10) || 3000,

  /**
   * How many reverse-proxy hops to trust for client IPs (Express
   * 'trust proxy'). 0 = directly exposed (default, spoof-proof);
   * 1 = behind a single proxy/PaaS edge (Railway, nginx). Without this,
   * req.ip behind a proxy is the proxy's address and every user would
   * share one rate-limit bucket.
   */
  trustProxyHops: Number.parseInt(process.env.TRUST_PROXY_HOPS, 10) || 0,

  /** OpenCage reverse-geocoding API key (https://opencagedata.com). */
  openCageKey: process.env.LOCATION_KEY || '',

  /** Contact email; MusicBrainz requires it in the User-Agent header. */
  contactEmail,

  /** MusicBrainz etiquette: identify the app and a way to reach its operator. */
  mbUserAgent: `Roadtripper/1.0.0 (${contactEmail})`,

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || '',
  },

  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  /**
   * Postgres connection string. When empty, the pg driver's defaults apply
   * (local socket, current OS user) with the database name below — which is
   * exactly right for a local trust-authenticated Postgres.
   */
  databaseUrl: process.env.DATABASE_URL || '',
  databaseName: process.env.PGDATABASE || 'songtripper',
};

module.exports = config;
