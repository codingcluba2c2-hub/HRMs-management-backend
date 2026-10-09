import Redis from 'ioredis';

// Use environment variable if available, else fallback to localhost
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: null,
  retryStrategy(times: number) {
    // Only retry 3 times, then stop to prevent hanging if Redis isn't installed locally
    if (times > 3) {
      console.warn('[REDIS] Connection failed after 3 retries. Disabling cache.');
      return null;
    }
    return Math.min(times * 100, 3000);
  },
});

redis.on('error', (err: any) => {
  // Only log if it's not a standard connection refused (which happens when local redis is missing)
  if (err.code !== 'ECONNREFUSED') {
    console.warn('[REDIS ERROR]', err.message);
  }
});

redis.on('connect', () => {
  console.log('✅ Redis Connected successfully.');
});

export const cacheMetrics = {
  hits: 0,
  misses: 0,
  getHitRatio() {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : (this.hits / total) * 100;
  }
};

export default redis;

const memoryCacheMap = new Map<string, { data: any; expiry: number }>();

export async function withCache<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
  const cachedMem = memoryCacheMap.get(key);
  if (cachedMem && Date.now() < cachedMem.expiry) {
    cacheMetrics.hits++;
    return cachedMem.data as T;
  }

  try {
    if (redis.status === 'ready') {
      const cached = await redis.get(key);
      if (cached) {
        cacheMetrics.hits++;
        const parsed = JSON.parse(cached) as T;
        memoryCacheMap.set(key, { data: parsed, expiry: Date.now() + ttlSeconds * 1000 });
        return parsed;
      }
    }
  } catch (error) {}

  cacheMetrics.misses++;
  const freshData = await fetcher();
  memoryCacheMap.set(key, { data: freshData, expiry: Date.now() + ttlSeconds * 1000 });

  try {
    if (redis.status === 'ready') {
      redis.setex(key, ttlSeconds, JSON.stringify(freshData)).catch(() => {});
    }
  } catch (e) {}

  return freshData;
}

export async function invalidateCachePattern(pattern: string) {
  try {
    if (redis.status === 'ready') {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  } catch (e) {
    // Fail silently if Redis error
  }
}

