import { logger } from '../utils/logger.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_TIMEOUT = 5000; // 5 seconds

/**
 * System prompt tailored for RecyConnect recyclable material classification.
 */
const SYSTEM_PROMPT = `You are an AI recyclable material classifier for RecyConnect, a waste management platform in Pakistan.
Analyze the image. We only support 4 categories of recyclable materials: plastic, paper, metal, and ewaste. If the image shows an unsupported item (like a cushion, furniture, food, animal, clothing, person, scenery, or any fake/unsupported picture), flag it as invalid.

You MUST respond with ONLY a valid JSON object (no markdown, no code fences, no explanation), using this exact structure:
{
  "isValidRecyclable": true or false,
  "validationMessage": "If isValidRecyclable is false, explain why (e.g. 'Cushion is not a supported recyclable material. RecyConnect only accepts plastic, paper, metal, and e-waste.'). Otherwise empty string.",
  "materialType": "one of: plastic, paper, metal, ewaste (or 'unsupported' if invalid)",
  "category": "specific sub-category if valid, or 'unsupported' if invalid",
  "title": "a recommended user-friendly listing title if valid, or 'Unsupported Item' if invalid",
  "description": "a recommended user-friendly description if valid, or 'This item is not supported' if invalid",
  "condition": "one of: good, fair, poor, contaminated",
  "confidence": 0.0 to 1.0,
  "isRecyclable": true or false
}`;

/**
 * Classify an image using Groq Vision API (Llama 4 Scout).
 * @param {string|null} imageUrl - Public URL of the image
 * @param {string|null} imageBase64 - Base64 encoded image (without data URI prefix)
 * @returns {Promise<object|null>} Classification result or null on failure
 */
export async function classifyWithGroq(imageUrl, imageBase64 = null) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    logger.warn('GROQ_API_KEY not configured, skipping Groq classification');
    return null;
  }

  try {
    // Build the image content part
    let imageContent;
    if (imageUrl) {
      imageContent = {
        type: 'image_url',
        image_url: { url: imageUrl }
      };
    } else if (imageBase64) {
      const base64Data = imageBase64.startsWith('data:')
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;
      imageContent = {
        type: 'image_url',
        image_url: { url: base64Data }
      };
    } else {
      logger.warn('Groq: No image URL or base64 provided');
      return null;
    }

    const payload = {
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Classify the recyclable material in this image. Return ONLY a JSON object.'
            },
            imageContent
          ]
        }
      ],
      temperature: 0.1,
      max_completion_tokens: 512,
      response_format: { type: 'json_object' }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT);

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Groq API error ${response.status}: ${errorBody}`);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      logger.warn('Groq: Empty response content');
      return null;
    }

    // Parse JSON response
    const result = parseClassificationJSON(content);
    if (result) {
      result.source = 'groq';
      logger.info(`Groq classification: ${result.materialType} (${(result.confidence * 100).toFixed(0)}%)`);
    }
    return result;

  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('Groq: Request timed out after 5s');
    } else {
      logger.error(`Groq classification error: ${err.message}`);
    }
    return null;
  }
}

/**
 * Parse the classification JSON from LLM response, handling edge cases.
 */
function parseClassificationJSON(content) {
  try {
    // Try direct parse first
    const parsed = JSON.parse(content);
    return validateClassificationResult(parsed);
  } catch {
    // Try extracting JSON from markdown code fences
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        return validateClassificationResult(parsed);
      } catch {
        // ignore
      }
    }

    // Try finding JSON object in the text
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        return validateClassificationResult(parsed);
      } catch {
        // ignore
      }
    }

    logger.warn(`Groq: Could not parse response as JSON: ${content.substring(0, 200)}`);
    return null;
  }
}

/**
 * Validate and normalize the classification result.
 */
function validateClassificationResult(parsed) {
  const validMaterials = ['plastic', 'paper', 'metal', 'ewaste', 'e-waste', 'unsupported'];

  // Normalize e-waste
  if (parsed.materialType === 'e-waste') {
    parsed.materialType = 'ewaste';
  }

  const mat = parsed.materialType ? parsed.materialType.toLowerCase() : 'unsupported';

  return {
    isValidRecyclable: parsed.isValidRecyclable !== false,
    validationMessage: parsed.validationMessage || '',
    materialType: validMaterials.includes(mat) ? mat : 'unsupported',
    category: parsed.category || 'unsupported',
    title: parsed.title || 'Unsupported Item',
    description: parsed.description || 'This item is not supported by RecyConnect.',
    condition: parsed.condition || 'fair',
    confidence: typeof parsed.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5,
    isRecyclable: parsed.isRecyclable !== false,
    source: 'groq'
  };
}
