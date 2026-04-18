import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

/**
 * Redis Client with graceful fallback
 * 
 * If REDIS_URL is not set or Redis is unreachable,
 * all cache operations silently no-op so the app
 * continues to work without caching.
 */

let redis = null;
let isConnected = false;

const REDIS_URL = process.env.REDIS_URL;
const IS_TEST = process.env.NODE_ENV === 'test';

if (REDIS_URL || IS_TEST) {
  try {
    redis = new Redis(REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) {
          logger.warn('[REDIS] Max retries reached. Giving up reconnection.');
          return null; // Stop retrying
        }
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
      connectTimeout: 5000,
    });

    redis.on('connect', () => {
      isConnected = true;
      logger.info('[REDIS] Connected successfully');
    });

    redis.on('error', (err) => {
      isConnected = false;
      logger.error('[REDIS] Connection error:', err.message);
    });

    redis.on('close', () => {
      isConnected = false;
      logger.warn('[REDIS] Connection closed');
    });

    // Attempt connection
    redis.connect().catch((err) => {
      logger.warn(`[REDIS] Could not connect: ${err.message}. Running without cache.`);
      redis = null;
    });

    if (IS_TEST) {
        isConnected = true;
    }
  } catch (err) {
    logger.warn(`[REDIS] Initialization failed: ${err.message}. Running without cache.`);
    if (!IS_TEST) redis = null;
  }
} else {
  logger.info('[REDIS] No REDIS_URL set. Running without cache.');
}

/**
 * Get a cached value by key
 * @param {string} key 
 * @returns {Promise<any|null>} Parsed JSON or null
 */
export const getCache = async (key) => {
  if (!redis || (!isConnected && !IS_TEST)) return null;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error(`[REDIS] GET error for key "${key}":`, err.message);
    return null;
  }
};

/**
 * Set a cached value with TTL
 * @param {string} key 
 * @param {any} data - Will be JSON.stringified
 * @param {number} ttlSeconds - Time-to-live in seconds (default 60)
 */
export const setCache = async (key, data, ttlSeconds = 60) => {
  if (!redis || (!isConnected && !process.env.NODE_ENV === 'test')) return;
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch (err) {
    logger.error(`[REDIS] SET error for key "${key}":`, err.message);
  }
};

/**
 * Delete a specific cache key
 * @param {string} key 
 */
export const deleteCache = async (key) => {
  if (!redis || (!isConnected && !process.env.NODE_ENV === 'test')) return;
  try {
    await redis.del(key);
  } catch (err) {
    logger.error(`[REDIS] DEL error for key "${key}":`, err.message);
  }
};

/**
 * Invalidate all cache keys matching a pattern
 * Uses SCAN to avoid blocking Redis on large datasets
 * @param {string} pattern - e.g. "cache:listings:*"
 */
export const invalidateCache = async (pattern) => {
  if (!redis || (!isConnected && !process.env.NODE_ENV === 'test')) return;
  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (err) {
    logger.error(`[REDIS] Invalidate error for pattern "${pattern}":`, err.message);
  }
};

/**
 * Check if Redis is connected
 * @returns {boolean}
 */
export const isRedisConnected = () => isConnected || process.env.NODE_ENV === 'test';

export default redis;
