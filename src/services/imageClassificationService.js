import crypto from 'crypto';
import { classifyWithGroq } from './groqVisionService.js';
import { classifyWithGemini } from './geminiVisionService.js';
import { logger } from '../utils/logger.js';
import { LRUCache } from '../utils/algorithms/lruCache.js';

// Instantiate LRU Cache with capacity of 50 classifications
const classificationCache = new LRUCache(50);

/**
 * Orchestrator: Classify an image using a 3-tier fallback strategy.
 * Includes an LRU Cache to avoid repeating expensive API classifications.
 *
 * Tier 1: Groq Vision API (Llama 4 Scout) — fastest, 5s timeout
 * Tier 2: Google Gemini API (Flash) — accurate, 8s timeout
 * Tier 3: Returns null — Flutter app falls back to TFLite on-device
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

  // ── Tier 1: Groq Vision (fastest) ────────────────────────────────
  try {
    logger.info('🔍 AI Classification: Trying Groq Vision (Tier 1)...');
    const groqResult = await classifyWithGroq(imageUrl, imageBase64);

    if (groqResult) {
      logger.info(`✅ Groq classification succeeded: ${groqResult.materialType} (${(groqResult.confidence * 100).toFixed(0)}%)`);
      if (cacheKey) classificationCache.put(cacheKey, groqResult);
      return groqResult;
    }
    logger.warn('⚠️ Groq returned no result, falling back to Gemini...');
  } catch (err) {
    logger.error(`❌ Groq failed: ${err.message}, falling back to Gemini...`);
  }

  // ── Tier 2: Google Gemini (accurate) ─────────────────────────────
  try {
    logger.info('🔍 AI Classification: Trying Gemini Vision (Tier 2)...');
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

  // ── Tier 3: Return null — Flutter falls back to TFLite ──────────
  logger.warn('🔄 All cloud classifiers failed. Client will use TFLite on-device fallback.');
  return null;
}
