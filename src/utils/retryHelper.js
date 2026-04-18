import { logger } from './logger.js';

/**
 * Exponential Backoff Executor
 * 
 * Executes an async function and retries it on failure with exponential backoff.
 * Delay doubles each retry (e.g. 1s -> 2s -> 4s -> 8s)
 * 
 * @param {Function} asyncFn - The async function to execute
 * @param {number} maxRetries - Maximum number of retries before failing
 * @param {number} initialDelayMs - Starting delay in milliseconds
 * @param {string} contextName - String label for logging
 * @returns {Promise<any>}
 */
export const withExponentialBackoff = async (
    asyncFn,
    maxRetries = 3,
    initialDelayMs = 1000,
    contextName = 'Task'
) => {
    let retries = 0;

    while (true) {
        try {
            return await asyncFn();
        } catch (error) {
            retries++;
            
            if (retries > maxRetries) {
                logger.error(`[BACKOFF] ${contextName} failed permanently after ${maxRetries} retries: ${error.message}`);
                throw error;
            }

            // Exponential delay mapping exactly to 1s -> 2s -> 4s -> 8s formula
            const delay = initialDelayMs * Math.pow(2, retries - 1);
            
            logger.warn(`[BACKOFF] ${contextName} failed. Retrying in ${delay}ms... (Attempt ${retries}/${maxRetries})`);
            
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
};
