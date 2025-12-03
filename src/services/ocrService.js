import { createWorker } from "tesseract.js";
import { logger } from "../utils/logger.js";
import fetch from "node-fetch";

let workerPromise;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      try {
        const worker = await createWorker("eng", 1, {
          workerPath:
            process.env.TESSERACT_WORKER_PATH ||
            "./node_modules/tesseract.js/src/worker-script/node/index.js",
          logger: (m) => {
            if (!m) return;
            const status = m.status || "progress";
            const progress =
              typeof m.progress === "number"
                ? ` ${(m.progress * 100).toFixed(1)}%`
                : "";
            logger.info(`OCR: ${status}${progress}`);
          },
        });
        return worker;
      } catch (err) {
        logger.error("Failed to initialize OCR worker: " + err.message);
        workerPromise = undefined;
        throw err;
      }
    })();
  }

  return workerPromise;
}

// OCR.space API integration
async function extractTextFromUrlWithOCRSpace(url) {
  const apiKey = process.env.OCR_SPACE_API_KEY || 'K87899142388957'; // Free API key

  try {
    logger.info(`🔍 Using OCR.space API for: ${url}`);

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {
        'apikey': apiKey,
      },
      body: new URLSearchParams({
        url: url,
        language: 'eng',
        isOverlayRequired: 'false',
        detectOrientation: 'true',
        scale: 'true',
        OCREngine: '2', // Use OCR Engine 2 for better accuracy
      }),
    });

    const data = await response.json();

    logger.info(`📡 OCR.space response: ${JSON.stringify(data).substring(0, 500)}`);

    if (data.IsErroredOnProcessing) {
      throw new Error(data.ErrorMessage?.[0] || 'OCR.space processing failed');
    }

    const text = data.ParsedResults?.[0]?.ParsedText || '';
    logger.info(`✅ OCR.space extracted ${text.length} characters: "${text.substring(0, 200)}..."`);
    return text.trim();

  } catch (err) {
    logger.error(`❌ OCR.space failed: ${err.message}`);
    throw err;
  }
}

export async function extractTextFromUrl(url) {
  if (!url) {
    logger.warn("OCR called with empty URL");
    return "";
  }

  try {
    // Try OCR.space first (better accuracy)
    const text = await extractTextFromUrlWithOCRSpace(url);

    const normalized = text.trim();
    logger.info(
      `OCR completed for ${url} (chars=${normalized.length}, empty=${normalized.length === 0
      })`
    );

    return normalized;
  } catch (ocrSpaceError) {
    // Fallback to Tesseract if OCR.space fails
    logger.warn(`OCR.space failed, falling back to Tesseract: ${ocrSpaceError.message}`);

    try {
      const worker = await getWorker();
      const {
        data: { text = "" },
      } = await worker.recognize(url);

      const normalized = text.trim();
      logger.info(
        `Tesseract OCR completed for ${url} (chars=${normalized.length})`
      );

      return normalized;
    } catch (tesseractError) {
      logger.error("Both OCR methods failed for " + url + ": " + tesseractError.message);
      return "";
    }
  }
}



export function extractCNIC(text) {

  const patterns = [
    /\b\d{5}-?\d{7}-?\d{1}\b/,           // Standard: 12345-1234567-1
    /\b\d{5}\s*-?\s*\d{7}\s*-?\s*\d{1}\b/, // With spaces
    /\b\d{13}\b/,                        // Without hyphens: 1234512345671
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Remove all non-digits
      const digits = match[0].replace(/\D/g, '');
      // Ensure it's exactly 13 digits
      if (digits.length === 13) {
        // Format as XXXXX-XXXXXXX-X
        return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
      }
    }
  }

  // Log the text for debugging
  logger.info(`CNIC extraction failed. Text length: ${text.length}, Sample: ${text.substring(0, 100)}`);
  return null;
}

export function extractNTN(text) {
  // Matches 7 digits, hyphen, 1 digit: 1234567-8
  const ntnRegex = /\b\d{7}-?\d{1}\b/;
  const match = text.match(ntnRegex);
  return match ? match[0].replace(/-/g, "") : null;
}

export function extractDate(text) {
  // Matches DD-MM-YYYY or DD/MM/YYYY or YYYY-MM-DD
  const dateRegex = /\b(\d{2}[-/]\d{2}[-/]\d{4})|(\d{4}[-/]\d{2}[-/]\d{2})\b/;
  const match = text.match(dateRegex);
  return match ? match[0] : null;
}

// --- Validation Helpers ---

export function validateCNIC(ocrText, inputCNIC) {
  if (!ocrText || !inputCNIC) return false;
  const extracted = extractCNIC(ocrText);
  if (!extracted) return false;
  return extracted === inputCNIC.replace(/-/g, "");
}

export function validateNTN(ocrText, inputNTN) {
  if (!ocrText || !inputNTN) return false;
  const extracted = extractNTN(ocrText);
  if (!extracted) return false;
  return extracted === inputNTN.replace(/-/g, "");
}

export async function shutdownOcrWorker() {
  if (!workerPromise) return;

  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch (err) {
    logger.warn("Failed to terminate OCR worker: " + err.message);
  } finally {
    workerPromise = undefined;
  }
}
