const fetch = require('node-fetch');
const { getCache, setCache } = require('../utils/cache');

async function getCityId(cityName, state = null) {
  const query = state ? `${cityName} ${state}` : cityName;
  const cacheKey = `city2id:${query.toLowerCase()}`;
  // Try cache first
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  const url = `https://musicbrainz.org/ws/2/place?query=${encodeURIComponent(query)}&fmt=json`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Roadtripper/1.0.0 (peterksharma@gmail.com)'
      }
    });
    if (!response.ok) throw new Error(`MusicBrainz city search error: ${response.status}`);
    const data = await response.json();
    if (data.places && data.places.length > 0) {
      for (const place of data.places) {
        if (place.area && place.area.type === 'City' && place.area.name.toLowerCase() === cityName.toLowerCase()) {
          await setCache(cacheKey, place.area.id, 604800); // 7 days
          return place.area.id;
        }
      }
      for (const place of data.places) {
        if (place.area && place.area.type === 'City') {
          await setCache(cacheKey, place.area.id, 604800); // 7 days
          return place.area.id;
        }
      }
    }
    throw new Error(`No city found for: ${cityName}`);
  } catch (e) {
    console.error('Error in getCityId:', e);
    throw e;
  }
}

async function getArtistsByCityId(cityId, limit = 10, email = process.env.EMAIL) {
  const cacheKey = `cityid2artists:${cityId}:${limit}`;
  // Try cache first
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  const url = `https://musicbrainz.org/ws/2/artist?area=${cityId}&limit=${limit}&fmt=json`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': `Roadtripper/1.0.0 (${email})`,
        'Accept': 'application/json'
      }
    });
    if (!response.ok) throw new Error(`MusicBrainz artist search error: ${response.status}`);
    const data = await response.json();
    await setCache(cacheKey, data.artists || [], 86400); // 24 hours
    return data.artists || [];
  } catch (e) {
    console.error('Error in getArtistsByCityId:', e);
    throw e;
  }
}

module.exports = { getCityId, getArtistsByCityId };
