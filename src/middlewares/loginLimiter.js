import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import redis from "../lib/redis.js";
import { logger } from "../utils/logger.js";

/**
 * Brute Force Protection for Login Endpoint
 *
 * Strategy:
 * 1. Limit by IP: Max 5 requests per IP per 15 minutes
 * 2. Limit by Email: Max 10 requests per email per hour
 * 3. Temporary IP block after threshold exceeded
 */

const createLoginStore = (prefix) => {
  if (!redis) return undefined;

  return new RedisStore({
    prefix,
    sendCommand: (command, ...args) => redis.call(command, ...args),
  });
};

// IP-based limiter: 5 attempts per 15 minutes
export const loginLimiterByIP = rateLimit({
  store: createLoginStore("login:ip:"),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  passOnStoreError: true,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn(`Brute force attempt detected from IP: ${req.ip}`, {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(429).json({
      success: false,
      message: "Too many login attempts. Please try again after 15 minutes.",
      retryAfter: req.rateLimit?.resetTime,
    });
  },
  keyGenerator: (req) => {
    // Get real IP from X-Forwarded-For (for load balancers/proxies)
    return ipKeyGenerator(req.ip || req.connection.remoteAddress || "unknown");
  },
  skip: (req) => {
    // Skip for GET/health checks
    return req.method !== "POST" || req.path !== "/login";
  },
});

// Email-based limiter: 10 attempts per hour
export const loginLimiterByEmail = rateLimit({
  store: createLoginStore("login:email:"),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 attempts
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const email = req.body?.identifier || "unknown";
    logger.warn(`Brute force attempt detected for email: ${email}`, {
      method: req.method,
      email,
      ip: req.ip,
    });

    res.status(429).json({
      success: false,
      message:
        "Too many login attempts for this account. Please try again after 1 hour or reset your password.",
      retryAfter: req.rateLimit?.resetTime,
    });
  },
  keyGenerator: (req) => {
    // Use email/identifier from request body as the key
    const identifier = req.body?.identifier || "";
    return identifier.toLowerCase().trim();
  },
  skip: (req) => {
    // Skip if no identifier provided
    return !req.body?.identifier;
  },
});

/**
 * Middleware to track failed login attempts
 * Call this AFTER password validation fails
 */
export async function trackFailedLoginAttempt(req, res, next) {
  try {
    const identifier = req.body?.identifier || "";
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const timestamp = new Date().toISOString();

    // Store failed attempt in Redis with expiry (24 hours)
    const failedAttemptKey = `failed_login:${identifier}:${ip}`;
    const currentCount = await redis.incr(failedAttemptKey);

    if (currentCount === 1) {
      // First attempt, set expiry
      await redis.expire(failedAttemptKey, 24 * 60 * 60);
    }

    logger.warn(`Failed login attempt for ${identifier}`, {
      ip,
      attempt_count: currentCount,
      timestamp,
    });

    // Alert admin if suspicious pattern detected (5+ attempts)
    if (currentCount >= 5) {
      logger.error(
        `🚨 BRUTE FORCE ALERT: ${identifier} from IP ${ip} (${currentCount} failed attempts)`,
        {
          identifier,
          ip,
          attempts: currentCount,
          severity: currentCount > 10 ? "CRITICAL" : "HIGH",
        },
      );

      // Could send Slack/Email alert here
    }

    next();
  } catch (err) {
    logger.error("Error tracking failed login", err);
    next(); // Don't block the request on logging error
  }
}

export default loginLimiterByIP;
