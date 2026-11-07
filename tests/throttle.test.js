const { createSerialThrottle } = require('../utils/throttle');

describe('createSerialThrottle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs tasks in FIFO order with starts spaced by the interval', async () => {
    const throttle = createSerialThrottle(1000);
    const starts = [];
    const task = (id) => async () => {
      starts.push({ id, at: Date.now() });
      return id;
    };

    const p1 = throttle(task('a'));
    const p2 = throttle(task('b'));
    const p3 = throttle(task('c'));

    await jest.advanceTimersByTimeAsync(5000);
    await expect(Promise.all([p1, p2, p3])).resolves.toEqual(['a', 'b', 'c']);

    expect(starts.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(starts[1].at - starts[0].at).toBeGreaterThanOrEqual(1000);
    expect(starts[2].at - starts[1].at).toBeGreaterThanOrEqual(1000);
  });

  it('a rejected task rejects its caller but does not poison the queue', async () => {
    const throttle = createSerialThrottle(100);
    const failing = throttle(async () => {
      throw new Error('boom');
    });
    // Attach the rejection handler immediately so the failure is observed.
    const observed = expect(failing).rejects.toThrow('boom');
    const succeeding = throttle(async () => 'fine');

    await jest.advanceTimersByTimeAsync(1000);
    await observed;
    await expect(succeeding).resolves.toBe('fine');
  });

  it('sheds load with a 503 when the queue is full instead of building a backlog', async () => {
    const throttle = createSerialThrottle(1000, 3);
    const running = [
      throttle(async () => 'a'),
      throttle(async () => 'b'),
      throttle(async () => 'c'),
    ];
    const overflow = throttle(async () => 'd');
    await expect(overflow).rejects.toMatchObject({ status: 503 });

    await jest.advanceTimersByTimeAsync(10_000);
    await expect(Promise.all(running)).resolves.toEqual(['a', 'b', 'c']);

    // capacity frees up once the queue drains
    const later = throttle(async () => 'e');
    await jest.advanceTimersByTimeAsync(5000);
    await expect(later).resolves.toBe('e');
  });

  it('does not delay a task that arrives after the interval has passed', async () => {
    const throttle = createSerialThrottle(1000);
    const first = throttle(async () => Date.now());
    await jest.advanceTimersByTimeAsync(0);
    await first;

    await jest.advanceTimersByTimeAsync(2000);
    const before = Date.now();
    const second = throttle(async () => Date.now());
    await jest.advanceTimersByTimeAsync(0);
    expect(await second).toBe(before);
  });
});
