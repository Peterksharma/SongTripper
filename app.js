const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cityRoutes = require('./routes/cityRoutes');
const artistRoutes = require('./routes/artistRoutes');
const songRoutes = require('./routes/songRoutes');
const spotifyAuthRoutes = require('./routes/spotifyAuthRoutes');
const errorHandler = require('./utils/errorHandler');

/**
 * The Express application, assembled without listening — server.js binds
 * the port; tests drive this app directly through supertest.
 */
const config = require('./config');

const app = express();

// Resolve req.ip through the configured number of proxy hops so the
// per-IP rate limiter keys on real clients when deployed behind a proxy.
app.set('trust proxy', config.trustProxyHops);

app.use(cors());
app.use(express.json());
if (process.env.NODE_ENV !== 'test') {
  // Skip the OAuth routes: their query strings carry authorization codes
  // and CSRF states, which must not end up in logs.
  app.use(morgan('dev', { skip: (req) => req.path.startsWith('/api/spotify/') }));
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'SongTripper API is running' });
});

app.use('/api/cities', cityRoutes);
app.use('/api/artists', artistRoutes);
app.use('/api/songs', songRoutes);
app.use('/api/spotify', spotifyAuthRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

module.exports = app;
