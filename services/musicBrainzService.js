const config = require('../config');
const ApiError = require('../utils/apiError');
const { getCache, setCache } = require('../utils/cache');
const { createSerialThrottle } = require('../utils/throttle');
const { upstreamFetch, readJson } = require('../utils/upstream');

/**
 * MusicBrainz Web Service v2 client.
 *
 * Every request goes through one serial throttle (1.1 s spacing — slightly
 * over MusicBrainz's 1 req/sec average so bursts never trip their limiter),
 * with a hard per-request timeout so one hung response cannot stall the
 * queue behind it, and a bounded queue so a burst sheds load with a 503
 * instead of building minutes of latency.
 *
 * MusicBrainz signals throttling with HTTP 503 and documents no
 * Retry-After, so on 503 we wait one interval and retry once.
 */
const MB_ROOT = 'https://musicbrainz.org/ws/2';
const MB_MIN_INTERVAL_MS = 1100;
const MB_TIMEOUT_MS = 10_000;
const AREA_TTL_SECONDS = 7 * 24 * 3600;
const ARTISTS_TTL_SECONDS = 24 * 3600;
const BROWSE_PAGE_SIZE = 100; // MusicBrainz's maximum

/**
 * Budget for disambiguating same-named cities: how many extra throttled
 * lookups one findCityArea call may spend walking "part of" parent chains.
 */
const DISAMBIGUATION_LOOKUP_BUDGET = 4;
const MAX_CANDIDATES_TO_VERIFY = 3;
const MAX_PARENT_HOPS = 2; // city → county → state covers the common case

const throttle = createSerialThrottle(MB_MIN_INTERVAL_MS);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mbRequest(path, params) {
  return throttle(async () => {
    const url = new URL(`${MB_ROOT}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('fmt', 'json');
    const options = { headers: { 'User-Agent': config.mbUserAgent } };

    let response = await upstreamFetch('MusicBrainz', url, options, MB_TIMEOUT_MS);
    if (response.status === 503) {
      await sleep(MB_MIN_INTERVAL_MS);
      response = await upstreamFetch('MusicBrainz', url, options, MB_TIMEOUT_MS);
    }
    if (!response.ok) {
      throw new ApiError(502, `MusicBrainz error (${response.status})`);
    }
    return readJson('MusicBrainz', response);
  });
}

/**
 * Escape Lucene query syntax characters in a user-derived term.
 * MusicBrainz search is Lucene; a city named "AC/DC Lane" must not become
 * a query operator. (Escaping list from the Lucene query-parser spec.)
 */
function escapeLucene(term) {
  return term.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
}

const normalize = (name) => (name || '').trim().toLowerCase();

/**
 * Fetch an area's direct "part of" parents (usually one: the county or
 * state containing a city). Costs one throttled request.
 */
async function getParentAreas(areaId) {
  const data = await mbRequest(`/area/${areaId}`, { inc: 'area-rels' });
  return (data.relations || [])
    .filter((rel) => rel.type === 'part of' && rel.direction === 'backward' && rel.area)
    .map((rel) => ({ id: rel.area.id, name: rel.area.name }));
}

/**
 * Does this candidate area sit inside the given state/country? Walks the
 * "part of" chain upward (city → county → state) comparing names, within
 * a shared lookup budget. Returns true/false/null (null = budget ran out,
 * undecided).
 */
async function candidateMatchesRegion(candidate, targets, budget) {
  let frontier = [candidate.id];
  for (let hop = 0; hop < MAX_PARENT_HOPS; hop++) {
    const next = [];
    for (const areaId of frontier) {
      if (budget.remaining <= 0) return null;
      budget.remaining -= 1;
      const parents = await getParentAreas(areaId);
      if (parents.some((p) => targets.has(normalize(p.name)))) return true;
      next.push(...parents.map((p) => p.id));
    }
    if (next.length === 0) return false;
    frontier = next;
  }
  return false;
}

/**
 * findCityArea(city, { state, country }) -> { areaId, areaName }
 *
 * Search the area index for City-typed areas by name (MusicBrainz orders
 * hits by relevance score). Same-named cities are a real hazard —
 * "Springfield" matches a dozen City areas — so when the geocoder gave us
 * a state/country, we verify candidates by walking their "part of" parent
 * chains (Austin → Travis County → Texas) within a small request budget.
 * If no candidate verifies before the budget runs out, we fall back to
 * the top-scored hit: MusicBrainz relevance is usually right, and a
 * best-guess answer beats a refusal. Results are cached per
 * (city, state, country).
 *
 * Throws ApiError(404) when MusicBrainz knows no such city.
 */
async function findCityArea(city, { state = null, country = null } = {}) {
  const cacheKey = `mb:area:${normalize(country)}:${normalize(state)}:${normalize(city)}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const data = await mbRequest('/area', {
    query: `"${escapeLucene(city)}" AND type:City`,
    limit: '10',
  });
  const candidates = (data.areas || []).filter((a) => a.type === 'City');
  if (candidates.length === 0) {
    throw new ApiError(404, `MusicBrainz has no city area named "${city}"`);
  }

  let hit = candidates[0];
  const targets = new Set([normalize(state), normalize(country)]);
  targets.delete('');
  if (candidates.length > 1 && targets.size > 0) {
    const budget = { remaining: DISAMBIGUATION_LOOKUP_BUDGET };
    for (const candidate of candidates.slice(0, MAX_CANDIDATES_TO_VERIFY)) {
      const verdict = await candidateMatchesRegion(candidate, targets, budget);
      if (verdict === true) {
        hit = candidate;
        break;
      }
      if (verdict === null) break; // budget exhausted — settle for the top hit
    }
  }

  const areaRef = { areaId: hit.id, areaName: hit.name };
  await setCache(cacheKey, areaRef, AREA_TTL_SECONDS);
  return areaRef;
}

/**
 * Lift a Spotify artist id out of MusicBrainz URL relations.
 * Match on the URL itself, not the relation type: Spotify links are filed
 * under varying types ("streaming", "free streaming"), but the resource URL
 * is unambiguous. Spotify ids are exactly 22 base-62 characters; anchoring
 * that here keeps malformed links from ever reaching the Spotify API.
 */
function extractSpotifyId(relations) {
  if (!Array.isArray(relations)) return null;
  for (const rel of relations) {
    const resource = rel.url && rel.url.resource;
    if (!resource) continue;
    const match = resource.match(/open\.spotify\.com\/artist\/([0-9A-Za-z]{22})/);
    if (match) return match[1];
  }
  return null;
}

/**
 * getArtistsFromArea(areaId, maxArtists) ->
 *   { artists: [{ mbId, name, type, spotifyId }], artistCount }
 *
 * Browse artists linked to the area. MusicBrainz matches the artist's main
 * area, begin/end area, or any descendant area — so "artists from Austin"
 * includes people born there and bands from its neighborhoods, which is
 * exactly the product's notion of "from here". `inc=url-rels` rides along
 * so linked artists resolve to Spotify by identity instead of name search.
 *
 * The browse is paged (100 per page, MusicBrainz's cap, one throttled call
 * each) up to maxArtists. Big cities exceed any sane page budget — Austin
 * alone has 4000+ artists, alphabetical — so `artistCount` reports the true
 * total and callers can tell a complete roster from a slice.
 */
async function getArtistsFromArea(areaId, maxArtists = BROWSE_PAGE_SIZE) {
  const cacheKey = `mb:areaartists:${areaId}:${maxArtists}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const artists = [];
  let artistCount = 0;
  for (let offset = 0; offset < maxArtists; offset += BROWSE_PAGE_SIZE) {
    const data = await mbRequest('/artist', {
      area: areaId,
      limit: String(Math.min(BROWSE_PAGE_SIZE, maxArtists - offset)),
      offset: String(offset),
      inc: 'url-rels',
    });
    artistCount = data['artist-count'] ?? artistCount;
    const page = data.artists || [];
    artists.push(
      ...page.map((a) => ({
        mbId: a.id,
        name: a.name,
        type: a.type || null,
        spotifyId: extractSpotifyId(a.relations),
      }))
    );
    if (page.length === 0 || artists.length >= artistCount) break;
  }

  const result = { artists: artists.slice(0, maxArtists), artistCount };
  await setCache(cacheKey, result, ARTISTS_TTL_SECONDS);
  return result;
}

module.exports = { findCityArea, getArtistsFromArea, extractSpotifyId, escapeLucene };
