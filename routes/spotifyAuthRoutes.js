const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const rateLimiter = require('../utils/rateLimiter');
const { upstreamFetch, readJson } = require('../utils/upstream');

/**
 * Spotify user OAuth (Authorization Code flow) — a forward-looking utility.
 *
 * The suggestion pipeline runs on app-level auth and does not need this.
 * These routes exist so a future client can obtain user tokens for
 * playlist writing. Tokens are returned to the caller and NOT stored:
 * the server keeps no user state by design (yet).
 *
 * CSRF protection: /login issues a random `state` nonce remembered for
 * STATE_TTL_MS; /callback only accepts a state it issued, exactly once.
 */
const router = express.Router();

const STATE_TTL_MS = 10 * 60 * 1000;
/** Hard cap: bounds memory no matter how fast an attacker hits /login. */
const MAX_PENDING_STATES = 10_000;
const pendingStates = new Map();

function pruneStates() {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [state, issuedAt] of pendingStates) {
    if (issuedAt < cutoff) pendingStates.delete(state);
  }
}

router.get('/login', rateLimiter, (req, res) => {
  if (!config.spotify.clientId || !config.spotify.redirectUri) {
    return res.status(503).json({ error: 'Spotify OAuth is not configured' });
  }
  pruneStates();
  // At the cap, evict the oldest state (Map preserves insertion order).
  while (pendingStates.size >= MAX_PENDING_STATES) {
    pendingStates.delete(pendingStates.keys().next().value);
  }
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.spotify.clientId,
    scope: 'playlist-modify-public playlist-modify-private user-read-private',
    redirect_uri: config.spotify.redirectUri,
    state,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

router.get('/callback', async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      return res.status(400).json({ error });
    }
    pruneStates();
    if (!state || !pendingStates.has(state)) {
      return res.status(400).json({ error: 'Unrecognized or expired state parameter' });
    }
    pendingStates.delete(state);
    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    const basic = Buffer.from(
      `${config.spotify.clientId}:${config.spotify.clientSecret}`
    ).toString('base64');
    const response = await upstreamFetch('Spotify accounts', 'https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.spotify.redirectUri,
      }),
    });
    if (!response.ok) {
      return res
        .status(502)
        .json({ error: `Spotify token exchange failed (${response.status})` });
    }
    const { access_token, refresh_token, expires_in } = await readJson('Spotify accounts', response);
    res.json({ access_token, refresh_token, expires_in });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
