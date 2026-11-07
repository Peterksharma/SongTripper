const ApiError = require('./apiError');

/**
 * createSerialThrottle(minIntervalMs, maxQueueLength) — a bounded FIFO
 * rate gate for outbound calls.
 *
 * schedule(task): tasks run strictly one at a time, in arrival order,
 * with consecutive *starts* at least minIntervalMs apart. This is how we
 * honor MusicBrainz's 1-request-per-second rule on our side of the wire,
 * regardless of how many concurrent HTTP clients hit our API.
 *
 * Algorithm: a promise chain serializes the tasks (each new task awaits
 * the settled tail), and `nextAllowedStart` — a virtual clock — enforces
 * the spacing. Invariant: when a task begins, Date.now() >=
 * nextAllowedStart, and nextAllowedStart is then advanced by
 * minIntervalMs.
 *
 * The queue is bounded: past maxQueueLength waiting tasks, schedule()
 * rejects immediately with a 503 instead of quietly building a
 * minutes-long backlog (each queued task costs its predecessors'
 * intervals in latency — better to shed load than to answer in minutes).
 *
 * A rejected task rejects its caller's promise but must not poison the
 * chain, hence the swallowed `.catch` when extending the tail.
 */
function createSerialThrottle(minIntervalMs, maxQueueLength = 10) {
  let tail = Promise.resolve();
  let nextAllowedStart = 0;
  let waiting = 0;

  function schedule(task) {
    if (waiting >= maxQueueLength) {
      return Promise.reject(
        new ApiError(503, 'Upstream request queue is full; try again shortly')
      );
    }
    waiting += 1;
    const run = tail.then(async () => {
      try {
        const wait = nextAllowedStart - Date.now();
        if (wait > 0) {
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        nextAllowedStart = Date.now() + minIntervalMs;
        return await task();
      } finally {
        waiting -= 1;
      }
    });
    tail = run.catch(() => {});
    return run;
  }

  return schedule;
}

module.exports = { createSerialThrottle };
