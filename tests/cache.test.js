/**
 * The cache contract under test: Redis down means misses and no-ops,
 * never exceptions, and never a hung request — plus a connection-attempt
 * cooldown so a dead Redis isn't re-dialed on every call.
 */

describe('cache resilience', () => {
  let createClientMock;

  function loadCacheWithClient(clientBehavior) {
    jest.resetModules();
    createClientMock = jest.fn(() => clientBehavior);
    jest.doMock('redis', () => ({ createClient: createClientMock }));
    return require('../utils/cache');
  }

  afterEach(() => {
    jest.dontMock('redis');
  });

  it('returns null / no-ops when Redis is unreachable, with one connect per cooldown', async () => {
    const client = {
      isOpen: false,
      isReady: false,
      on: jest.fn(),
      connect: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const { getCache, setCache } = loadCacheWithClient(client);

    await expect(getCache('k')).resolves.toBeNull();
    await expect(setCache('k', { a: 1 })).resolves.toBeUndefined();
    await expect(getCache('k')).resolves.toBeNull();

    // Cooldown: the failed connect is attempted once, not once per call.
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('round-trips JSON values through a healthy client', async () => {
    const store = new Map();
    const client = {
      isOpen: false,
      isReady: false,
      on: jest.fn(),
      connect: jest.fn().mockImplementation(async function () {
        client.isOpen = true;
        client.isReady = true;
      }),
      get: jest.fn(async (key) => store.get(key) ?? null),
      set: jest.fn(async (key, value) => {
        store.set(key, value);
      }),
    };
    const { getCache, setCache } = loadCacheWithClient(client);

    await setCache('city', { name: 'Austin' }, 60);
    expect(client.set).toHaveBeenCalledWith('city', JSON.stringify({ name: 'Austin' }), { EX: 60 });
    await expect(getCache('city')).resolves.toEqual({ name: 'Austin' });
    await expect(getCache('missing')).resolves.toBeNull();
  });

  it('treats a corrupt cache entry as a miss', async () => {
    const client = {
      isOpen: true,
      isReady: true,
      on: jest.fn(),
      connect: jest.fn(),
      get: jest.fn(async () => 'not-json{{{'),
    };
    const { getCache } = loadCacheWithClient(client);
    await expect(getCache('k')).resolves.toBeNull();
  });

  it('configures the client to fail fast instead of queueing while disconnected', async () => {
    const client = {
      isOpen: true,
      isReady: true,
      on: jest.fn(),
      connect: jest.fn(),
      get: jest.fn(async () => null),
    };
    const { getCache } = loadCacheWithClient(client);
    await getCache('k');
    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ disableOfflineQueue: true })
    );
  });
});
