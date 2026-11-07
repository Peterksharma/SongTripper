jest.mock('pg', () => {
  const mockClient = { query: jest.fn(), release: jest.fn() };
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(async () => mockClient),
    on: jest.fn(),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mockPool), __mockPool: mockPool, __mockClient: mockClient };
});

const { __mockPool: pool, __mockClient: client } = require('pg');
const repository = require('../db/repository');

describe('repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findCity', () => {
    it('returns the first row or null, comparing NULL state/country as equal', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Austin' }] });
      expect(await repository.findCity('Austin', 'Texas', 'United States')).toEqual({
        id: 1,
        name: 'Austin',
      });
      expect(pool.query.mock.calls[0][0]).toContain('IS NOT DISTINCT FROM');
      expect(pool.query.mock.calls[0][1]).toEqual(['Austin', 'Texas', 'United States']);

      pool.query.mockResolvedValueOnce({ rows: [] });
      expect(await repository.findCity('Nowhere', null, null)).toBeNull();
    });
  });

  describe('getFreshCityArtists', () => {
    it('returns null when the roster was never fetched', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ artists_fetched_at: null }] });
      expect(await repository.getFreshCityArtists(1)).toBeNull();
    });

    it('returns null when the roster is stale', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
      pool.query.mockResolvedValueOnce({ rows: [{ artists_fetched_at: eightDaysAgo }] });
      expect(await repository.getFreshCityArtists(1)).toBeNull();
    });

    it('returns camelCase-mapped artists when fresh', async () => {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      pool.query
        .mockResolvedValueOnce({ rows: [{ artists_fetched_at: yesterday }] })
        .mockResolvedValueOnce({
          rows: [
            { mb_id: 'mb-1', name: 'A', spotify_id: 'S1', popularity: 5, genres: ['g'] },
          ],
        });
      expect(await repository.getFreshCityArtists(1)).toEqual([
        { mbId: 'mb-1', name: 'A', spotifyId: 'S1', popularity: 5, genres: ['g'] },
      ]);
    });
  });

  describe('saveCityArtists (transactional)', () => {
    it('wraps the roster write in BEGIN/COMMIT and releases the client', async () => {
      client.query.mockImplementation(async (sql) =>
        sql.includes('RETURNING id') ? { rows: [{ id: 42 }] } : { rows: [] }
      );
      await repository.saveCityArtists(7, [
        { mbId: 'mb-1', name: 'A', spotifyId: null },
        { mbId: 'mb-2', name: 'B', spotifyId: 'S2' },
      ]);

      const issued = client.query.mock.calls.map(([sql]) => sql);
      expect(issued[0]).toBe('BEGIN');
      expect(issued.at(-1)).toBe('COMMIT');
      expect(issued.some((sql) => sql.includes('artists_fetched_at = now()'))).toBe(true);
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back and releases on mid-transaction failure', async () => {
      client.query.mockImplementation(async (sql) => {
        if (sql.includes('INSERT INTO artists')) throw new Error('constraint violation');
        return { rows: [] };
      });
      await expect(
        repository.saveCityArtists(7, [{ mbId: 'mb-1', name: 'A', spotifyId: null }])
      ).rejects.toThrow('constraint violation');

      const issued = client.query.mock.calls.map(([sql]) => sql);
      expect(issued).toContain('ROLLBACK');
      expect(issued).not.toContain('COMMIT');
      expect(client.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateArtistSpotify', () => {
    it('passes null for unknown popularity/genres so COALESCE keeps stored values', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await repository.updateArtistSpotify('mb-1', {
        spotifyId: 'S1',
        popularity: undefined,
        genres: [],
      });
      expect(pool.query.mock.calls[0][1]).toEqual(['mb-1', 'S1', null, null]);
      // Lite-mode nulls must never clobber rich-mode data.
      expect(pool.query.mock.calls[0][0]).toContain('COALESCE($3, artists.popularity)');
      expect(pool.query.mock.calls[0][0]).toContain('COALESCE($4, artists.genres)');
    });

    it('writes real values through', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await repository.updateArtistSpotify('mb-1', {
        spotifyId: 'S1',
        popularity: 73,
        genres: ['indie'],
      });
      expect(pool.query.mock.calls[0][1]).toEqual(['mb-1', 'S1', 73, ['indie']]);
    });
  });

  describe('roster determinism', () => {
    it('orders the roster query (ranking depends on stable order)', async () => {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      pool.query
        .mockResolvedValueOnce({ rows: [{ artists_fetched_at: yesterday }] })
        .mockResolvedValueOnce({ rows: [] });
      await repository.getFreshCityArtists(1);
      expect(pool.query.mock.calls[1][0]).toContain('ORDER BY');
    });
  });
});
