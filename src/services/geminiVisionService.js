import { GoogleGenAI, Type } from '@google/genai';
import { logger } from '../utils/logger.js';

// Initialize the client. It automatically picks up the GEMINI_API_KEY environment variable.
const ai = new GoogleGenAI({});
const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Classify an image using Google Gemini Vision API via the official Gen AI SDK.
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

    // Call the Gemini 2.5 Flash Model using the official SDK
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          inlineData: {
            data: cleanBase64,
            mimeType: 'image/jpeg'
          }
        },
        "Analyze this image and classify the recyclable material shown."
      ],
      config: {
        systemInstruction: "You are a precise computer vision system for RecyConnect, a waste management platform. Analyze the uploaded image. We only support 4 recyclable waste categories: plastic, paper, metal, and ewaste (electronic waste). If the image shows any other item (like furniture, cushions, food, clothing, animals, humans, scenery, or any fake/unsupported picture), set isValidRecyclable to false and provide a validationMessage. Otherwise, set isValidRecyclable to true, determine the materialType, category, generate a user-friendly title and description for the listing. Do not apologize, do not write prose, and only return the structured JSON data requested.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isValidRecyclable: {
              type: Type.BOOLEAN,
              description: "True if the item in the image is a valid recyclable waste material belonging to one of these 4 supported categories: plastic, paper, metal, ewaste. False if the image is of something else (e.g. food, furniture like a cushion or mattress, a pet, scenery, clothing, humans, random non-waste item, or a fake/unsupported picture)."
            },
            validationMessage: {
              type: Type.STRING,
              description: "If isValidRecyclable is false, provide a friendly message explaining what was detected and that RecyConnect only supports Plastic, Paper, Metal, and E-Waste (e.g., 'This item appears to be a cushion/furniture, which is not supported. Please upload plastic, paper, metal, or e-waste.'). If isValidRecyclable is true, this can be empty."
            },
            materialType: { 
              type: Type.STRING, 
              description: "The general type of recyclable material if valid. Must be one of: plastic, paper, metal, ewaste. If invalid, return 'unsupported'." 
            },
            category: { 
              type: Type.STRING, 
              description: "The specific sub-category of the item if valid (e.g., PET bottle, cardboard box, copper wire, laptop). If invalid, return 'unsupported'." 
            },
            title: {
              type: Type.STRING,
              description: "A recommended short title for a listing if valid (e.g., 'PET Plastic Bottles', 'Old Laptop', 'Used Cardboard Boxes'). If invalid, return 'Unsupported Item'."
            },
            description: {
              type: Type.STRING,
              description: "A recommended description for the listing if valid (e.g., 'Clean PET plastic water bottles ready for recycling. Approx weight is specified.'). If invalid, return 'This item is not supported by RecyConnect.'"
            },
            condition: { 
              type: Type.STRING, 
              description: "The visual condition of the material. Must be one of: good, fair, poor, contaminated." 
            },
            confidence: { 
              type: Type.NUMBER, 
              description: "A confidence score between 0.00 and 1.00." 
            },
            isRecyclable: { 
              type: Type.BOOLEAN, 
              description: "Whether the material is recyclable." 
            }
          },
          required: ["isValidRecyclable", "validationMessage", "materialType", "category", "title", "description", "condition", "confidence", "isRecyclable"],
        },
      }
    });

    const content = response.text;
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
    logger.error(`Gemini classification error: ${err.message}`);
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
  const validMaterials = ['plastic', 'paper', 'metal', 'ewaste', 'e-waste', 'unsupported'];

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
    source: 'gemini'
  };
}
