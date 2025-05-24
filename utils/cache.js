const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: redisUrl });

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});

async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}

async function getCache(key) {
  await connectRedis();
  const value = await redisClient.get(key);
  return value ? JSON.parse(value) : null;
}

async function setCache(key, value, ttlSeconds = 3600) {
  await connectRedis();
  await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
}

module.exports = { redisClient, getCache, setCache }; 