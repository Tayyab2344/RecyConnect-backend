import Tesseract from 'tesseract.js'
import { logger } from '../utils/logger.js'

export async function extractTextFromUrl(url) {
  try {
    const { data: { text } } = await Tesseract.recognize(url, 'eng', { logger: m => logger.info('OCR: ' + m.status) })
    return text
  } catch (err) {
    logger.error('OCR failed: ' + err.message)
    return ''
  }
}
