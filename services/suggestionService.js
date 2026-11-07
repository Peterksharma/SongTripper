const locationService = require('./locationService');
const musicBrainz = require('./musicBrainzService');
const spotify = require('./spotifyService');
const repository = require('../db/repository');
const ApiError = require('../utils/apiError');
const { getCache, setCache } = require('../utils/cache');
const { geoKey } = require('../utils/geo');

/**
 * The suggestion pipeline — the reason this server exists:
 *
 *   GPS ──▶ city (OpenCage) ──▶ MusicBrainz area ──▶ artist roster
 *       ──▶ Spotify resolution ──▶ ranking ──▶ top tracks ──▶ playlist
 *
 * Dependency policy: the three upstream APIs are load-bearing — if the one
 * a step needs is down, the request fails with a meaningful status. The
 * cache (Redis) and the database (Postgres) are accelerants — every use is
 * wrapped in bestEffort() and their failure only costs speed/persistence.
 */
const SUGGESTION_TTL_SECONDS = 24 * 3600;

/**
 * Cold-city artist pool: three MusicBrainz browse pages (one throttled
 * call each, ~2.2s extra on a city's first-ever request, cached and
 * persisted afterwards). MusicBrainz browses alphabetically, so a bigger
 * pool means a fairer shot at including the city's notable linked artists.
 */
const ARTIST_POOL_SIZE = 300;

/**
 * How many un-linked artists we'll try to resolve by name search per
 * request. Each costs a Spotify call inside a 30-second rate window, and
 * MusicBrainz's roster is alphabetical (not by notability), so past a
 * point more searches buy little.
 */
const SEARCH_RESOLUTION_BUDGET = 15;

/** How many ranked artists contribute tracks (one Spotify call each). */
const MAX_RANKED_ARTISTS = 10;

/**
 * Guard for cache/DB work: failures are logged and swallowed so
 * persistence never breaks a request. Never used around load-bearing calls.
 */
async function bestEffort(label, promise) {
  try {
    return await promise;
  } catch (e) {
    console.warn(`[best-effort] ${label}: ${e.message}`);
    return null;
  }
}

/**
 * Round-robin interleave ("card dealing"): take one track from each
 * artist's list in turn until `limit` tracks are dealt. This spreads the
 * playlist across artists instead of front-loading one artist's whole
 * catalog. Duplicate URIs (collaboration tracks credited to two local
 * artists) are dealt only once.
 */
function interleaveTracks(trackLists, limit) {
  const dealt = [];
  const seen = new Set();
  const longest = Math.max(0, ...trackLists.map((list) => list.length));
  for (let round = 0; round < longest && dealt.length < limit; round++) {
    for (const list of trackLists) {
      if (dealt.length >= limit) break;
      const track = list[round];
      if (!track || seen.has(track.uri)) continue;
      seen.add(track.uri);
      dealt.push(track);
    }
  }
  return dealt;
}

/**
 * Resolve a MusicBrainz artist roster to Spotify identities.
 *
 * Two tiers, in order of trust:
 *   1. Identity links — MB url-relations give exact Spotify ids; verified
 *      (and popularity-enriched where the API still allows) in batch.
 *   2. Name search — budgeted fallback for unlinked artists, exact-name
 *      matches only.
 * The returned list preserves that order (linked first), which doubles as
 * the ranking tiebreak when popularity is unavailable: a MusicBrainz
 * editor bothering to link an artist to Spotify is itself a notability
 * signal.
 */
async function resolveToSpotify(roster) {
  const linked = roster.filter((a) => a.spotifyId);
  const unlinked = roster.filter((a) => !a.spotifyId);

  const resolved = await spotify.enrichWithPopularity(linked);

  // Partial search failures are tolerable (some artists just won't make
  // it into this answer) — but if EVERY attempt failed and nothing else
  // resolved, that is a Spotify outage, not an empty city, and it must
  // surface as one. allSettled keeps the two cases distinguishable:
  // fulfilled-null means "no such artist", rejected means "call failed".
  const searchFailures = [];
  if (resolved.length < MAX_RANKED_ARTISTS && unlinked.length > 0) {
    const candidates = unlinked.slice(0, SEARCH_RESOLUTION_BUDGET);
    const settled = await Promise.allSettled(
      candidates.map((artist) => spotify.searchArtist(artist.name))
    );
    settled.forEach((outcome, i) => {
      if (outcome.status === 'rejected') {
        searchFailures.push(outcome.reason);
        console.warn(`[search "${candidates[i].name}"] ${outcome.reason.message}`);
      } else if (outcome.value) {
        resolved.push({
          mbId: candidates[i].mbId,
          name: outcome.value.name,
          spotifyId: outcome.value.spotifyId,
          popularity: outcome.value.popularity,
          genres: outcome.value.genres,
        });
      }
    });
  }
  if (resolved.length === 0 && searchFailures.length > 0) {
    throw searchFailures[0];
  }

  // Two MB entries can point at one Spotify artist (e.g. a person and
  // their one-man band); keep the first (higher-trust) occurrence.
  const seen = new Set();
  const unique = resolved.filter((a) => {
    if (seen.has(a.spotifyId)) return false;
    seen.add(a.spotifyId);
    return true;
  });

  await Promise.all(
    unique.map((a) =>
      bestEffort(
        `persist resolution of ${a.name}`,
        repository.updateArtistSpotify(a.mbId, a)
      )
    )
  );

  return unique;
}

/**
 * Rank artists for suggestion: popularity descending. Array.prototype.sort
 * is stable (ECMAScript 2019+), so when popularity is unavailable (all
 * null → all equal at -1) the linked-first construction order from
 * resolveToSpotify() carries through as the ranking.
 */
function rankArtists(resolved) {
  return [...resolved]
    .sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1))
    .slice(0, MAX_RANKED_ARTISTS);
}

/**
 * getSongsByLocation(lat, lng, limit) -> {
 *   location, musicBrainzAreaId, artists, tracks
 * }
 * Precondition: lat/lng/limit already validated by the controller.
 */
async function getSongsByLocation(lat, lng, limit) {
  const cacheKey = `songs:v1:${geoKey(lat, lng)}:${limit}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  // 1. Where are we?
  const place = await locationService.convertGpsToCity(lat, lng);
  if (!place.city) {
    throw new ApiError(404, 'No city found at these coordinates');
  }

  // 2. Which MusicBrainz area is that? (Postgres remembers; MB is asked once.)
  let cityRow = await bestEffort(
    'find city in DB',
    repository.findCity(place.city, place.state, place.country)
  );
  let areaId = cityRow ? cityRow.mb_area_id : null;
  if (!areaId) {
    const area = await musicBrainz.findCityArea(place.city, {
      state: place.state,
      country: place.country,
    });
    areaId = area.areaId;
    cityRow = await bestEffort(
      'upsert city',
      repository.upsertCity({
        name: place.city,
        state: place.state,
        country: place.country,
        mbAreaId: areaId,
      })
    );
  }

  // 3. Who is from there? (Fresh DB roster, else one MB browse page.)
  let roster = null;
  if (cityRow) {
    roster = await bestEffort(
      'load fresh roster from DB',
      repository.getFreshCityArtists(cityRow.id)
    );
  }
  if (!roster || roster.length === 0) {
    ({ artists: roster } = await musicBrainz.getArtistsFromArea(areaId, ARTIST_POOL_SIZE));
    if (cityRow && roster.length > 0) {
      await bestEffort(
        'save roster to DB',
        repository.saveCityArtists(cityRow.id, roster)
      );
    }
  }
  if (roster.length === 0) {
    throw new ApiError(404, `MusicBrainz lists no artists for ${place.city}`);
  }

  // 4. Which of them can Spotify actually play?
  const resolved = await resolveToSpotify(roster);
  if (resolved.length === 0) {
    throw new ApiError(
      404,
      `No artists from ${place.city} could be found on Spotify`
    );
  }

  // 5. Rank, fetch tracks, deal them out. One artist's fetch failing is
  // tolerable; ALL of them failing is a Spotify outage and must not be
  // dressed up as "this city has no tracks".
  const ranked = rankArtists(resolved);
  const market = place.countryCode || 'US';
  const settled = await Promise.allSettled(
    ranked.map((artist) => spotify.getTopTracks(artist, market))
  );
  const trackLists = settled.map((outcome, i) => {
    if (outcome.status === 'rejected') {
      console.warn(`[top tracks for ${ranked[i].name}] ${outcome.reason.message}`);
      return [];
    }
    return outcome.value.map((t) => ({
      ...t,
      artist: {
        name: ranked[i].name,
        spotifyId: ranked[i].spotifyId,
        musicBrainzId: ranked[i].mbId,
      },
    }));
  });
  const tracks = interleaveTracks(trackLists, limit);
  if (tracks.length === 0) {
    const failures = settled.filter((outcome) => outcome.status === 'rejected');
    if (failures.length > 0 && failures.length === settled.length) {
      throw failures[0].reason;
    }
    throw new ApiError(
      404,
      `Found artists from ${place.city} but no playable tracks on Spotify`
    );
  }

  const payload = {
    location: place,
    musicBrainzAreaId: areaId,
    artists: ranked.map((a) => ({
      name: a.name,
      spotifyId: a.spotifyId,
      musicBrainzId: a.mbId,
      popularity: a.popularity,
      genres: a.genres,
    })),
    tracks,
  };
  await setCache(cacheKey, payload, SUGGESTION_TTL_SECONDS);
  return payload;
}

module.exports = {
  getSongsByLocation,
  // exported for focused unit tests
  interleaveTracks,
  rankArtists,
  resolveToSpotify,
};
