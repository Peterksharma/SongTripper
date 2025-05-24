const fetch = require('node-fetch');
const { getCache, setCache } = require('../utils/cache');
const locationToken = process.env.LOCATION_KEY;

async function convertGpsToCity(latitude, longitude) {
  if (!locationToken) throw new Error('LOCATION_KEY is not set in environment variables');
  const cacheKey = `gps2city:${latitude},${longitude}`;
  // Try cache first
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  try {
    const url = `https://api.opencagedata.com/geocode/v1/json?q=${latitude}+${longitude}&key=${locationToken}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`OpenCage API error: ${response.status}`);
    const data = await response.json();
    // Cache for 24 hours
    await setCache(cacheKey, data, 86400);
    return data;
  } catch (e) {
    console.error('Error in convertGpsToCity:', e);
    throw e;
  }
}

module.exports = { convertGpsToCity };
