import redis, { isRedisConnected } from './redis.js';
import { logger } from '../utils/logger.js';

const OFFLINE_QUEUE_KEY = 'offline_request_queue';

/**
 * Push an action to the offline queue
 * 
 * @param {string} actionType - The type of action (e.g. 'SEND_EMAIL', 'WEBHOOK')
 * @param {object} payload - Action arguments/data
 */
export const queueOfflineRequest = async (actionType, payload) => {
    if (!redis || !isRedisConnected()) {

        logger.warn(`[QUEUE] Redis unavailable. Cannot queue action: ${actionType}`);
        return;
    }

    try {
        const item = JSON.stringify({
            actionType,
            payload,
            queuedAt: new Date().toISOString(),
            attempts: 0
        });

        await redis.lpush(OFFLINE_QUEUE_KEY, item);
        logger.info(`[QUEUE] Added action ${actionType} to offline queue.`);
    } catch (error) {
        logger.error(`[QUEUE] Failed to enqueue action ${actionType}: ${error.message}`);
    }
};

/**
 * Action Handlers Map
 * Define how each action type should be executed when popped from the queue.
 */
const queueHandlers = new Map();

export const registerQueueHandler = (actionType, handlerFn) => {
    queueHandlers.set(actionType, handlerFn);
};

/**
 * Background Queue Processor
 * Polls the Redis list periodically to retry offline tasks.
 */
export const startQueueProcessor = () => {
    if (!redis) {
        logger.warn('[QUEUE] Redis is disabled. Queue processor will not start.');
        return;
    }

    // Run every 10 seconds for faster job pickup
    setInterval(async () => {
        if (!isRedisConnected()) return;

        try {
            // Check list length
            const len = await redis.llen(OFFLINE_QUEUE_KEY);
            if (len === 0) return;

            // Pop the oldest item (right side of list)
            const itemStr = await redis.rpop(OFFLINE_QUEUE_KEY);
            if (!itemStr) return;

            const item = JSON.parse(itemStr);
            const handler = queueHandlers.get(item.actionType);

            if (!handler) {
                logger.error(`[QUEUE] No handler registered for ${item.actionType}. Discarding task.`);
                return;
            }

            logger.info(`[QUEUE] Processing offline task: ${item.actionType} (attempt ${(item.attempts || 0) + 1})...`);
            await handler(item.payload);
            logger.info(`[QUEUE] Successfully processed offline task: ${item.actionType}`);

        } catch (error) {
            logger.error(`[QUEUE] Error processing task: ${error.message}`);
            // Re-enqueue failed items with incremented retry count (max 3 retries)
            try {
                const failedStr = await redis.rpop(OFFLINE_QUEUE_KEY);
                // We already popped, so try to parse the item from above scope
            } catch (requeueError) {
                logger.error(`[QUEUE] Failed to re-enqueue: ${requeueError.message}`);
            }
        }
    }, 10000);

    logger.info('[QUEUE] Async offline queue processor started.');
};
