const { getPool } = require('./pool');

/**
 * Persistence for discovered cities and artists.
 *
 * Contract: these functions throw on database failure. Callers that treat
 * Postgres as an optimization (the suggestion pipeline) wrap them in
 * best-effort guards; callers that require durability (the migration
 * script) let the error propagate.
 *
 * Row shapes returned here use the snake_case column names as-is; the
 * service layer maps them to API shapes.
 */

/** How long a city's artist roster is trusted before re-fetching from MusicBrainz. */
const ARTIST_ROSTER_MAX_AGE_DAYS = 7;

/**
 * Find a city by (name, state, country). IS NOT DISTINCT FROM makes NULL
 * state/country compare as equal, which plain `=` would not.
 */
async function findCity(name, state, country) {
  const { rows } = await getPool().query(
    `SELECT * FROM cities
      WHERE lower(name) = lower($1)
        AND state   IS NOT DISTINCT FROM $2
        AND country IS NOT DISTINCT FROM $3
      LIMIT 1`,
    [name, state, country]
  );
  return rows[0] || null;
}

/**
 * Insert or refresh a city keyed by its MusicBrainz area MBID (the stable
 * identity; names and admin divisions can be spelled differently by
 * different geocoders).
 */
async function upsertCity({ name, state, country, mbAreaId }) {
  const { rows } = await getPool().query(
    `INSERT INTO cities (name, state, country, mb_area_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (mb_area_id) DO UPDATE
       SET name = EXCLUDED.name,
           state = EXCLUDED.state,
           country = EXCLUDED.country
     RETURNING *`,
    [name, state, country, mbAreaId]
  );
  return rows[0];
}

/**
 * Return the city's artist roster if it was fetched recently enough,
 * else null (meaning: go ask MusicBrainz again).
 */
async function getFreshCityArtists(cityId, maxAgeDays = ARTIST_ROSTER_MAX_AGE_DAYS) {
  const pool = getPool();
  const cityResult = await pool.query(
    `SELECT artists_fetched_at FROM cities WHERE id = $1`,
    [cityId]
  );
  const city = cityResult.rows[0];
  if (!city || !city.artists_fetched_at) return null;
  const ageMs = Date.now() - new Date(city.artists_fetched_at).getTime();
  if (ageMs > maxAgeDays * 24 * 3600 * 1000) return null;

  // Deterministic, best-known-first order: downstream ranking and the
  // name-search budget both depend on roster order, so heap order (which
  // reshuffles as rows are updated) would make suggestions flap between
  // requests.
  const { rows } = await pool.query(
    `SELECT a.mb_id, a.name, a.spotify_id, a.popularity, a.genres
       FROM city_artists ca
       JOIN artists a ON a.id = ca.artist_id
      WHERE ca.city_id = $1
      ORDER BY a.popularity DESC NULLS LAST, lower(a.name), a.id`,
    [cityId]
  );
  return rows.map((r) => ({
    mbId: r.mb_id,
    name: r.name,
    spotifyId: r.spotify_id,
    popularity: r.popularity,
    genres: r.genres,
  }));
}

/**
 * Store a freshly-fetched artist roster for a city, atomically:
 * upsert each artist, link it to the city, stamp the fetch time.
 * A Spotify id already known in the DB is never overwritten with NULL
 * (COALESCE keeps the strongest information we have).
 */
async function saveCityArtists(cityId, artists) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const artist of artists) {
      const { rows } = await client.query(
        `INSERT INTO artists (mb_id, name, spotify_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (mb_id) DO UPDATE
           SET name = EXCLUDED.name,
               spotify_id = COALESCE(EXCLUDED.spotify_id, artists.spotify_id)
         RETURNING id`,
        [artist.mbId, artist.name, artist.spotifyId || null]
      );
      await client.query(
        `INSERT INTO city_artists (city_id, artist_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [cityId, rows[0].id]
      );
    }
    await client.query(
      `UPDATE cities SET artists_fetched_at = now() WHERE id = $1`,
      [cityId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Record what Spotify told us about an artist (resolution + popularity).
 * COALESCE keeps the strongest information we have: a lite-mode run (which
 * learns no popularity/genres) must never erase values a rich-mode run
 * already stored.
 */
async function updateArtistSpotify(mbId, { spotifyId, popularity, genres }) {
  await getPool().query(
    `UPDATE artists
        SET spotify_id = COALESCE($2, artists.spotify_id),
            popularity = COALESCE($3, artists.popularity),
            genres = COALESCE($4, artists.genres),
            spotify_checked_at = now()
      WHERE mb_id = $1`,
    [mbId, spotifyId ?? null, popularity ?? null, genres && genres.length ? genres : null]
  );
}

module.exports = {
  findCity,
  upsertCity,
  getFreshCityArtists,
  saveCityArtists,
  updateArtistSpotify,
  ARTIST_ROSTER_MAX_AGE_DAYS,
};
