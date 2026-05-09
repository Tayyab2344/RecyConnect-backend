import { logger } from '../utils/logger.js';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_TIMEOUT = 8000; // 8 seconds

/**
 * Prompt for Gemini — same classification schema as Groq for consistency.
 */
const CLASSIFICATION_PROMPT = `You are an AI recyclable material classifier for RecyConnect, a waste management platform.
Analyze this image and classify the recyclable material shown.

Respond with ONLY a valid JSON object (no markdown, no code fences), using this exact structure:
{
  "materialType": "one of: plastic, paper, metal, ewaste, glass, organic, textile, rubber, wood, mixed",
  "category": "specific sub-category (e.g., PET bottles, cardboard, copper wire, circuit boards)",
  "condition": "one of: good, fair, poor, contaminated",
  "confidence": 0.0 to 1.0,
  "description": "brief 1-line description of what you see",
  "isRecyclable": true or false
}`;

/**
 * Classify an image using Google Gemini Vision API.
 * @param {string|null} imageUrl - Public URL of the image (will be fetched and converted to base64)
 * @param {string|null} imageBase64 - Base64 encoded image (without data URI prefix)
 * @returns {Promise<object|null>} Classification result or null on failure
 */
export async function classifyWithGemini(imageUrl, imageBase64 = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not configured, skipping Gemini classification');
    return null;
  }

  try {
    let base64Data = imageBase64;

    // If we have a URL but no base64, fetch the image and convert
    if (!base64Data && imageUrl) {
      base64Data = await fetchImageAsBase64(imageUrl);
      if (!base64Data) {
        logger.warn('Gemini: Failed to fetch image from URL');
        return null;
      }
    }

    if (!base64Data) {
      logger.warn('Gemini: No image data provided');
      return null;
    }

    // Strip data URI prefix if present
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: cleanBase64
              }
            },
            {
              text: CLASSIFICATION_PROMPT
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
        responseMimeType: 'application/json'
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Gemini API error ${response.status}: ${errorBody}`);
      return null;
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      logger.warn('Gemini: Empty response content');
      return null;
    }

    // Parse JSON response
    const result = parseGeminiResponse(content);
    if (result) {
      result.source = 'gemini';
      logger.info(`Gemini classification: ${result.materialType} (${(result.confidence * 100).toFixed(0)}%)`);
    }
    return result;

  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('Gemini: Request timed out after 8s');
    } else {
      logger.error(`Gemini classification error: ${err.message}`);
    }
    return null;
  }
}

/**
 * Fetch an image URL and convert to base64.
 */
async function fetchImageAsBase64(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch (err) {
    logger.error(`Failed to fetch image for Gemini: ${err.message}`);
    return null;
  }
}

/**
 * Parse Gemini response JSON with fallback extraction.
 */
function parseGeminiResponse(content) {
  try {
    const parsed = JSON.parse(content);
    return validateResult(parsed);
  } catch {
    // Try extracting JSON from code fences
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return validateResult(JSON.parse(jsonMatch[1].trim()));
      } catch { /* ignore */ }
    }

    // Try finding JSON object
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return validateResult(JSON.parse(objectMatch[0]));
      } catch { /* ignore */ }
    }

    logger.warn(`Gemini: Could not parse response: ${content.substring(0, 200)}`);
    return null;
  }
}

/**
 * Validate and normalize classification result.
 */
function validateResult(parsed) {
  const validMaterials = [
    'plastic', 'paper', 'metal', 'ewaste', 'e-waste',
    'glass', 'organic', 'textile', 'rubber', 'wood', 'mixed'
  ];

  if (parsed.materialType === 'e-waste') {
    parsed.materialType = 'ewaste';
  }

  if (!parsed.materialType || !validMaterials.includes(parsed.materialType.toLowerCase())) {
    return null;
  }

  return {
    materialType: parsed.materialType.toLowerCase(),
    category: parsed.category || parsed.materialType,
    condition: parsed.condition || 'fair',
    confidence: typeof parsed.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5,
    description: parsed.description || '',
    isRecyclable: parsed.isRecyclable !== false,
    source: 'gemini'
  };
}
