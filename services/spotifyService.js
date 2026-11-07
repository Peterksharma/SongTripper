const config = require('../config');
const ApiError = require('../utils/apiError');
const { upstreamFetch, readJson } = require('../utils/upstream');

/**
 * App-level Spotify access (Client Credentials flow — no user login).
 *
 * Spotify's February 2026 platform changes removed several endpoints for
 * apps registered after 2026-02-11 (artist top-tracks, batch artist gets,
 * the `popularity` field), while apps registered earlier keep them. This
 * service therefore ADAPTS at runtime:
 *
 *   rich strategy — top-tracks endpoint + batch artists + popularity
 *                   ranking (grandfathered apps);
 *   lite strategy — track search filtered by artist identity, no
 *                   popularity (new development-mode apps).
 *
 * A 403/410 from a rich endpoint flips the strategy permanently for this
 * process; 404s only count against it after a few in a row, because a
 * single 404 can also mean "this artist id no longer exists".
 */
const ACCOUNTS_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_ROOT = 'https://api.spotify.com/v1';
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const SEARCH_LIMIT = 10; // hard maximum for development-mode apps since Feb 2026
const BATCH_ARTIST_CHUNK = 50;
const MAX_RETRY_AFTER_SECONDS = 15;
const RICH_404_TOLERANCE = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let richEndpointsAvailable = true;
let consecutiveRich404s = 0;

let tokenCache = { value: null, expiresAt: 0 };

/** Fetch (and memoize) an app token; refreshed one minute before expiry. */
async function getAppToken() {
  if (!config.spotify.clientId || !config.spotify.clientSecret) {
    throw new ApiError(503, 'Server is missing Spotify credentials (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)');
  }
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) {
    return tokenCache.value;
  }
  const basic = Buffer.from(
    `${config.spotify.clientId}:${config.spotify.clientSecret}`
  ).toString('base64');
  const response = await upstreamFetch('Spotify accounts', ACCOUNTS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!response.ok) {
    throw new ApiError(502, `Spotify token request failed (${response.status})`);
  }
  const data = await readJson('Spotify accounts', response);
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS,
  };
  return tokenCache.value;
}

/**
 * Authenticated GET with the two retries worth having:
 * 401 → token expired early, refresh once; 429 → honor Retry-After once
 * (bounded — a long lockout becomes a clean 503 instead of a hung request).
 * Failures carry `upstreamStatus` so callers can react to specific codes.
 */
async function spotifyGet(path, params = {}, retried = false) {
  const token = await getAppToken();
  const url = new URL(`${API_ROOT}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  const response = await upstreamFetch('Spotify', url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401 && !retried) {
    tokenCache = { value: null, expiresAt: 0 };
    return spotifyGet(path, params, true);
  }
  if (response.status === 429 && !retried) {
    const retryAfter = Number.parseInt(response.headers.get('retry-after'), 10);
    if (Number.isFinite(retryAfter) && retryAfter <= MAX_RETRY_AFTER_SECONDS) {
      await sleep((retryAfter + 1) * 1000);
      return spotifyGet(path, params, true);
    }
    throw new ApiError(503, 'Spotify rate limit reached; try again shortly');
  }
  if (!response.ok) {
    const error = new ApiError(502, `Spotify error (${response.status})`);
    error.upstreamStatus = response.status;
    throw error;
  }
  return readJson('Spotify', response);
}

function noteRichFailure(upstreamStatus) {
  if (upstreamStatus === 403 || upstreamStatus === 410) {
    richEndpointsAvailable = false;
    return true;
  }
  if (upstreamStatus === 404) {
    consecutiveRich404s += 1;
    if (consecutiveRich404s >= RICH_404_TOLERANCE) {
      richEndpointsAvailable = false;
    }
    return true;
  }
  return false;
}

function noteRichSuccess() {
  consecutiveRich404s = 0;
}

const normalizeName = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * enrichWithPopularity(artists) -> same artists + { popularity, genres }.
 *
 * Input artists must carry spotifyId. Uses the batch endpoint when the app
 * still has it (1 call per 50 artists); when it doesn't, popularity simply
 * stays null — fetching artists one-by-one would cost N rate-limited calls
 * to learn a field Spotify strips from new apps anyway.
 */
async function enrichWithPopularity(artists) {
  if (artists.length === 0) return [];
  if (!richEndpointsAvailable) {
    // Preserve any popularity/genres the caller already knows (e.g. from
    // Postgres, written back when the rich endpoints still worked) —
    // overwriting known signal with null would destroy the ranking.
    return artists.map((a) => ({ ...a, popularity: a.popularity ?? null, genres: a.genres || [] }));
  }
  try {
    const byId = new Map();
    for (let i = 0; i < artists.length; i += BATCH_ARTIST_CHUNK) {
      const chunk = artists.slice(i, i + BATCH_ARTIST_CHUNK);
      const data = await spotifyGet('/artists', {
        ids: chunk.map((a) => a.spotifyId).join(','),
      });
      for (const artist of data.artists || []) {
        if (artist) byId.set(artist.id, artist);
      }
    }
    noteRichSuccess();
    // An id missing from the response is a dead link (artist removed from
    // Spotify) — drop it rather than suggest something unplayable.
    return artists
      .filter((a) => byId.has(a.spotifyId))
      .map((a) => {
        const s = byId.get(a.spotifyId);
        return {
          ...a,
          name: s.name,
          popularity: s.popularity ?? null,
          genres: s.genres || [],
        };
      });
  } catch (e) {
    if (noteRichFailure(e.upstreamStatus)) {
      return artists.map((a) => ({ ...a, popularity: a.popularity ?? null, genres: a.genres || [] }));
    }
    throw e;
  }
}

/**
 * searchArtist(name) -> { spotifyId, name, popularity, genres } | null.
 *
 * Only an exact (normalized) name match is accepted: suggesting the wrong
 * same-named artist from another city is worse than suggesting nothing.
 * Among exact matches, prefer the most popular (when popularity exists;
 * otherwise Spotify's own relevance order, i.e. the first).
 */
async function searchArtist(name) {
  const data = await spotifyGet('/search', {
    q: `artist:"${name.replace(/"/g, '')}"`,
    type: 'artist',
    limit: String(SEARCH_LIMIT),
  });
  const candidates = ((data.artists && data.artists.items) || []).filter(
    (item) => normalizeName(item.name) === normalizeName(name)
  );
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) =>
    (b.popularity ?? -1) > (a.popularity ?? -1) ? b : a
  );
  return {
    spotifyId: best.id,
    name: best.name,
    popularity: best.popularity ?? null,
    genres: best.genres || [],
  };
}

function mapTrack(t) {
  return {
    spotifyTrackId: t.id,
    uri: t.uri,
    name: t.name,
    album: (t.album && t.album.name) || null,
    albumImage:
      (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) ||
      null,
    durationMs: t.duration_ms ?? null,
    popularity: t.popularity ?? null,
    previewUrl: t.preview_url ?? null,
    explicit: t.explicit ?? false,
  };
}

/**
 * getTopTracks(artist, market) -> track[] (possibly empty).
 *
 * Rich strategy: the dedicated top-tracks endpoint (`market` is required
 * with an app token — without it Spotify considers all content unavailable).
 * Lite strategy: search tracks by the artist's name, then keep only tracks
 * actually credited to the artist's Spotify id — the name is just the
 * search net; identity does the filtering. Sorted by track popularity when
 * present, Spotify relevance order otherwise.
 */
async function getTopTracks(artist, market) {
  if (richEndpointsAvailable) {
    try {
      const data = await spotifyGet(`/artists/${artist.spotifyId}/top-tracks`, {
        market: market || 'US',
      });
      noteRichSuccess();
      return (data.tracks || []).map(mapTrack);
    } catch (e) {
      if (!noteRichFailure(e.upstreamStatus)) throw e;
      // fall through to the lite strategy for this call
    }
  }
  const data = await spotifyGet('/search', {
    q: `artist:"${artist.name.replace(/"/g, '')}"`,
    type: 'track',
    limit: String(SEARCH_LIMIT),
    market: market || undefined,
  });
  const items = (data.tracks && data.tracks.items) || [];
  return items
    .filter((t) => (t.artists || []).some((a) => a.id === artist.spotifyId))
    .sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1))
    .map(mapTrack);
}

/** Test seam: reset adaptive state and the memoized token. */
function resetForTests() {
  richEndpointsAvailable = true;
  consecutiveRich404s = 0;
  tokenCache = { value: null, expiresAt: 0 };
}

module.exports = {
  getAppToken,
  enrichWithPopularity,
  searchArtist,
  getTopTracks,
  resetForTests,
};
