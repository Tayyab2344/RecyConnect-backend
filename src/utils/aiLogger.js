import { logger } from './logger.js';

/**
 * Logs an AI-specific system event with nested telemetry metadata.
 * These logs are caught by the Prisma transport and pushed to the neon database.
 * 
 * @param {string} event - The name of the AI event (e.g. 'PICKUP_COMPLETED', 'FRAUD_DETECTED')
 * @param {Object} [data] - Telemetry metadata payload (e.g. efficiency score, GPS risk)
 */
export function logAiEvent(event, data = {}) {
  logger.info(`[AI EVENT] ${event}`, {
    type: 'AI',
    event,
    ...data,
    timestamp: new Date().toISOString()
  });
}

export default logAiEvent;
