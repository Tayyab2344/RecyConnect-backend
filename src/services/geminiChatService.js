import { logger } from '../utils/logger.js';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_TIMEOUT = 10000; // 10 seconds

/**
 * Generate text content using Google Gemini API.
 * @param {string} prompt - The prompt text.
 * @param {string} systemInstruction - Optional system instruction.
 * @param {boolean} isJson - If true, configures response to be parsed as JSON.
 * @returns {Promise<string|null>} The generated text content or null on failure.
 */
export async function generateTextWithGemini(prompt, systemInstruction = '', isJson = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not configured, skipping Gemini text generation');
    return null;
  }

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024
      }
    };

    if (systemInstruction) {
      payload.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    if (isJson) {
      payload.generationConfig.responseMimeType = 'application/json';
    }

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
      logger.error(`Gemini Text API error ${response.status}: ${errorBody}`);
      return null;
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    return content || null;
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('Gemini Text: Request timed out after 10s');
    } else {
      logger.error(`Gemini text generation error: ${err.message}`);
    }
    return null;
  }
}
