-- SongTripper schema. Idempotent: safe to run repeatedly (npm run db:migrate).
--
-- Postgres is the durable memory of what has been discovered: which cities
-- map to which MusicBrainz areas, which artists belong to which cities, and
-- how those artists resolve to Spotify. Redis in front of it holds hot,
-- expiring copies; Postgres survives restarts and cache evictions.

CREATE TABLE IF NOT EXISTS cities (
  id                 SERIAL PRIMARY KEY,
  name               TEXT        NOT NULL,
  state              TEXT,
  country            TEXT,
  mb_area_id         UUID        NOT NULL UNIQUE,
  -- when the city_artists set for this city was last refreshed from
  -- MusicBrainz; NULL means never fetched
  artists_fetched_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cities_lookup
  ON cities (lower(name), state, country);

CREATE TABLE IF NOT EXISTS artists (
  id                 SERIAL PRIMARY KEY,
  mb_id              UUID        NOT NULL UNIQUE,
  name               TEXT        NOT NULL,
  spotify_id         TEXT,
  popularity         INTEGER,
  genres             TEXT[]      NOT NULL DEFAULT '{}',
  -- when Spotify data (id/popularity/genres) was last refreshed
  spotify_checked_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS city_artists (
  city_id       INTEGER     NOT NULL REFERENCES cities (id)  ON DELETE CASCADE,
  artist_id     INTEGER     NOT NULL REFERENCES artists (id) ON DELETE CASCADE,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, artist_id)
);
