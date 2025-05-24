const request = require('supertest');
const express = require('express');
const spotifyAuthRoutes = require('../routes/spotifyAuthRoutes');

describe('spotifyAuthRoutes', () => {
  let app;
  beforeAll(() => {
    process.env.SPOTIFY_CLIENT_ID = 'testid';
    process.env.SPOTIFY_CLIENT_SECRET = 'testsecret';
    process.env.SPOTIFY_REDIRECT_URI = 'http://localhost:8888/callback';
    app = express();
    app.use('/api/spotify', spotifyAuthRoutes);
  });

  it('GET /api/spotify/login redirects to Spotify', async () => {
    const res = await request(app).get('/api/spotify/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.spotify\.com\/authorize/);
  });
});
