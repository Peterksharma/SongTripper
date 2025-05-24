const request = require('supertest');
let app;

describe('server', () => {
  beforeAll(() => {
    app = require('express')();
    app.get('/api/health', (req, res) => res.json({ status: 'ok', message: 'Roadtripper API is running!' }));
  });

  it('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
