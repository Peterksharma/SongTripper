const express = require('express');
const axios = require('axios');
const querystring = require('querystring');

const router = express.Router();

const client_id = process.env.SPOTIFY_CLIENT_ID;
const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
const redirect_uri = process.env.SPOTIFY_REDIRECT_URI;

// Step 1: Redirect user to Spotify login
router.get('/login', (req, res) => {
  const scope = [
    'playlist-modify-public',
    'playlist-modify-private',
    'user-read-private'
  ].join(' ');

  const params = querystring.stringify({
    response_type: 'code',
    client_id,
    scope,
    redirect_uri,
    state: 'some-random-state' // In production, generate a real random state
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// Step 2: Handle callback and exchange code for tokens
router.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const error = req.query.error || null;

  if (error) {
    return res.status(400).json({ error });
  }

  try {
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      querystring.stringify({
        code,
        redirect_uri,
        grant_type: 'authorization_code',
        client_id,
        client_secret
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    res.json({ access_token, refresh_token, expires_in });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get tokens', details: err.message });
  }
});

module.exports = router; 