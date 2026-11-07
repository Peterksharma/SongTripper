process.env.SPOTIFY_CLIENT_ID = 'test-client';
process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
process.env.SPOTIFY_REDIRECT_URI = 'http://localhost:3000/api/spotify/callback';

// /login is rate-limited (state-map protection); the limiter would 429
// supertest's rapid-fire requests. It has its own unit test.
jest.mock('../utils/rateLimiter', () => (req, res, next) => next());

const request = require('supertest');
const app = require('../app');

describe('Spotify user OAuth routes', () => {
  afterEach(() => {
    delete global.fetch;
  });

  it('login redirects to Spotify with a fresh random state', async () => {
    const res = await request(app).get('/api/spotify/login');
    expect(res.status).toBe(302);

    const url = new URL(res.headers.location);
    expect(url.origin).toBe('https://accounts.spotify.com');
    expect(url.searchParams.get('client_id')).toBe('test-client');
    expect(url.searchParams.get('redirect_uri')).toBe(process.env.SPOTIFY_REDIRECT_URI);
    expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{32}$/);

    const second = await request(app).get('/api/spotify/login');
    expect(new URL(second.headers.location).searchParams.get('state')).not.toBe(
      url.searchParams.get('state')
    );
  });

  it('callback rejects an unknown state (CSRF protection)', async () => {
    const res = await request(app).get('/api/spotify/callback?code=abc&state=forged');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/state/i);
  });

  it('callback relays Spotify-reported errors', async () => {
    const res = await request(app).get('/api/spotify/callback?error=access_denied');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('access_denied');
  });

  it('exchanges the code exactly once per issued state', async () => {
    const login = await request(app).get('/api/spotify/login');
    const state = new URL(login.headers.location).searchParams.get('state');

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
    }));

    const res = await request(app).get(`/api/spotify/callback?code=abc&state=${state}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 });

    const tokenCall = global.fetch.mock.calls[0];
    expect(String(tokenCall[0])).toBe('https://accounts.spotify.com/api/token');
    const body = tokenCall[1].body.toString();
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=abc');

    // replaying the same state must fail — it was consumed
    const replay = await request(app).get(`/api/spotify/callback?code=abc&state=${state}`);
    expect(replay.status).toBe(400);
  });

  it('callback surfaces a failed exchange as 502', async () => {
    const login = await request(app).get('/api/spotify/login');
    const state = new URL(login.headers.location).searchParams.get('state');
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({}) }));

    const res = await request(app).get(`/api/spotify/callback?code=bad&state=${state}`);
    expect(res.status).toBe(502);
  });
});
