import crypto from 'crypto';
import { classifyWithGemini } from './geminiVisionService.js';
import { logger } from '../utils/logger.js';
import { LRUCache } from '../utils/algorithms/lruCache.js';

// Instantiate LRU Cache with capacity of 50 classifications
const classificationCache = new LRUCache(50);

/**
 * Orchestrator: Classify an image using a 2-tier fallback strategy.
 * Includes an LRU Cache to avoid repeating expensive API classifications.
 *
 * Tier 1: Google Gemini API (Flash) — accurate, 8s timeout
 * Tier 2: Returns null — Flutter app falls back to TFLite on-device
 *
 * @param {string|null} imageUrl - Public URL of the image
 * @param {string|null} imageBase64 - Base64 encoded image
 * @returns {Promise<object|null>} Classification result with `source` field, or null
 */
export async function classifyImage(imageUrl = null, imageBase64 = null) {
  if (!imageUrl && !imageBase64) {
    logger.warn('classifyImage: No image data provided');
    return null;
  }

  // ── Cache Lookup ─────────────────────────────────────────────────
  // Generate cache key: Use URL directly, or MD5 hash of base64 data
  const cacheKey = imageUrl || (imageBase64 ? crypto.createHash('md5').update(imageBase64).digest('hex') : null);
  if (cacheKey) {
    const cached = classificationCache.get(cacheKey);
    if (cached) {
      logger.info(`⚡ [LRU CACHE HIT] Returning cached classification for image: ${cached.materialType}`);
      return cached;
    }
  }

  // ── Tier 1: Google Gemini (accurate) ─────────────────────────────
  try {
    logger.info('🔍 AI Classification: Trying Gemini Vision (Tier 1)...');
    const geminiResult = await classifyWithGemini(imageUrl, imageBase64);

    if (geminiResult) {
      logger.info(`✅ Gemini classification succeeded: ${geminiResult.materialType} (${(geminiResult.confidence * 100).toFixed(0)}%)`);
      if (cacheKey) classificationCache.put(cacheKey, geminiResult);
      return geminiResult;
    }
    logger.warn('⚠️ Gemini returned no result');
  } catch (err) {
    logger.error(`❌ Gemini failed: ${err.message}`);
  }

  // ── Tier 2: Return null — Flutter falls back to TFLite ──────────
  logger.warn('🔄 Cloud classifier failed. Client will use TFLite on-device fallback.');
  return null;
}
