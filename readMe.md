# SongTripper API

A server that answers one question: **"What music is *from* here?"**

Send it GPS coordinates and it returns playable Spotify tracks by artists
from that place — the local scene, the hometown heroes, the band that
formed two neighborhoods over. Thin clients (phone apps, CarPlay, a web
player) come later; this server owns all the intelligence.

## How it works

```
GET /api/songs/by-location?lat=30.267&lng=-97.743
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. GPS → city          OpenCage reverse geocoding           │
│ 2. city → area         MusicBrainz area search              │
│ 3. area → artists      MusicBrainz browse (born/based here) │
│ 4. artists → Spotify   identity links first, name search    │
│                        as budgeted fallback                 │
│ 5. rank & deal         popularity ranking, round-robin      │
│                        across artists for variety           │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
{ location, artists, tracks: [{ uri, name, album, artist, … }] }
```

Two data stores, both optional at runtime:

- **Redis** — hot cache (geocoding, areas, rosters, finished answers).
  Down? Everything still works, just slower.
- **Postgres** — durable memory (cities, artists, city↔artist links,
  Spotify resolutions). Down? Requests still succeed; the server just
  doesn't remember between restarts.

The three upstream APIs (OpenCage, MusicBrainz, Spotify) are load-bearing:
if the one a request needs is unreachable, that request fails with an
honest 502/503 rather than a fabricated answer.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness check |
| `GET /api/songs/by-location?lat=&lng=&limit=` | **flagship**: playable tracks by artists from here (`limit` 1–50, default 10) |
| `GET /api/artists/by-location?lat=&lng=&limit=` | raw MusicBrainz artist roster, unranked (`limit` 1–100, default 25) |
| `GET /api/cities/lookup?lat=&lng=` | reverse-geocode only |
| `GET /api/spotify/login` → `/callback` | user OAuth (future playlist writing; not needed for suggestions) |

Coordinates are validated (`lat` ∈ [-90, 90], `lng` ∈ [-180, 180]) and
rounded to a ~1.1 km grid for caching, so a moving car reuses cache
entries instead of re-paying every upstream call.

## Setup

```bash
npm install
cp .env.example .env       # then fill in the keys
docker compose up -d       # Redis
createdb songtripper       # local Postgres (Homebrew)
npm run db:migrate         # apply db/schema.sql (idempotent)
npm run dev                # or: npm start
```

Required keys (see `.env.example`): `LOCATION_KEY` (OpenCage), `EMAIL`
(MusicBrainz User-Agent etiquette), `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`
(app-level Client Credentials — no user login involved).

```bash
npm test                   # 105 tests, no network needed
```

## Spotify API note (Feb 2026 platform changes)

Spotify removed several endpoints for apps registered after 2026‑02‑11
(artist top-tracks, batch artist gets, the `popularity` field). This
server **adapts at runtime**:

- **Rich strategy** (apps registered before the cutoff): dedicated
  top-tracks endpoint, batch popularity ranking.
- **Lite strategy** (newer apps): track search filtered by artist
  identity; ranking falls back to MusicBrainz link presence (an editor
  bothering to link an artist to Spotify is itself a notability signal).

A 403/410 from a rich endpoint flips the strategy automatically; the API
contract to clients is identical either way.

## Upstream etiquette

- **MusicBrainz**: all requests flow through one serial throttle (≥1.1 s
  spacing — their 1 req/sec rule), with a proper `User-Agent`, and one
  retry on 503.
- **Spotify**: honors `Retry-After` on 429 (bounded; long lockouts become
  a clean 503), refreshes the app token on 401.
- Inbound, each client IP gets 1 request/second on the data endpoints.

## Layout

```
app.js                  express app (exported for tests)
server.js               entrypoint: listen + graceful shutdown
config.js               env, read once
routes/ controllers/    HTTP layer (validation, shaping)
services/               locationService, musicBrainzService,
                        spotifyService, suggestionService (the pipeline)
db/                     schema.sql, pool, repository
utils/                  cache, throttle, geo grid, rate limiter, errors
tests/                  105 tests, all upstreams mocked
```

## Roadmap

1. **Now** — this server, local.
2. **Next** — deploy (Railway), thin mobile client that sends GPS and
   plays the returned `spotify:track:` URIs.
3. **Later** — user accounts + stored OAuth tokens, server-written
   "Road Trip" playlists, trip history, cache warming for popular routes.
