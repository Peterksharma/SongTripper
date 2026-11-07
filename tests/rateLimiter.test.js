const rateLimiter = require('../utils/rateLimiter');

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('inbound per-IP rate limiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('accepts the first request and rejects an immediate second from the same IP', () => {
    const ip = `10.0.0.${Math.floor(Math.random() * 255)}`; // isolate from other tests
    const next = jest.fn();
    const res = makeRes();

    rateLimiter({ ip }, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    rateLimiter({ ip }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(429);
  });

  it('accepts again once the window has passed', () => {
    const ip = '10.1.1.1';
    const next = jest.fn();

    rateLimiter({ ip }, makeRes(), next);
    jest.advanceTimersByTime(1100);
    rateLimiter({ ip }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('tracks IPs independently', () => {
    const next = jest.fn();
    rateLimiter({ ip: '10.2.2.1' }, makeRes(), next);
    rateLimiter({ ip: '10.2.2.2' }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
