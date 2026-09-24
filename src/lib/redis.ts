import Redis from 'ioredis';

// Use environment variable if available, else fallback to localhost
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
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

/**
 * Cache Wrapper to safely wrap asynchronous functions.
 * Fallback to executing the query directly if Redis is down.
 */
export async function withCache<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
  try {
    if (redis.status !== 'ready') {
      return await fetcher();
    }

    const cached = await redis.get(key);
    if (cached) {
      cacheMetrics.hits++;
      return JSON.parse(cached) as T;
    }

    cacheMetrics.misses++;
    const freshData = await fetcher();
    // Background cache set
    redis.setex(key, ttlSeconds, JSON.stringify(freshData)).catch(() => {});
    
    return freshData;
  } catch (error) {
    // Fallback if Redis fails
    return await fetcher();
  }
}
