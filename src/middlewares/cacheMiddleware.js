import { getCache, setCache } from '../lib/redis.js';

/**
 * Express middleware for caching JSON responses in Redis.
 * 
 * Usage:
 *   router.get('/dashboard', authenticate, cacheResponse(60), getDashboardStats);
 * 
 * @param {number} ttlSeconds - Cache TTL in seconds
 * @param {Function} [keyGenerator] - Optional custom key generator (req) => string
 * @returns {Function} Express middleware
 */
export const cacheResponse = (ttlSeconds = 60, keyGenerator = null) => {
  return async (req, res, next) => {
    // Generate cache key
    const cacheKey = keyGenerator
      ? keyGenerator(req)
      : buildDefaultCacheKey(req);

    try {
      // Check cache
      const cached = await getCache(cacheKey);
      if (cached) {
        // Cache hit — return cached response
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
    } catch (err) {
      // Cache error — continue without cache
    }

    // Cache miss — intercept res.json to capture the response
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setCache(cacheKey, data, ttlSeconds).catch(() => {});
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson(data);
    };

    next();
  };
};

/**
 * Build a default cache key from the request
 * Format: cache:{path}:{sortedQueryString}:{userId}
 */
function buildDefaultCacheKey(req) {
  const path = req.originalUrl || req.url;
  const userId = req.user?.id || 'anon';
  // Sort query params for consistent keys
  const sortedQuery = Object.keys(req.query)
    .sort()
    .map(k => `${k}=${req.query[k]}`)
    .join('&');

  return `cache:${req.baseUrl}${req.path}:${sortedQuery}:${userId}`;
}
