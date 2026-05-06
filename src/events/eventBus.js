import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { invalidateCache } from '../lib/redis.js';
import { queueOfflineRequest } from '../lib/queueManager.js';
import prisma from '../lib/prisma.js';
import { sendPushNotification } from '../services/firebaseService.js';

// Central Event Bus Node
class SystemEventBus extends EventEmitter {}

export const EventBus = new SystemEventBus();

/**
 * Event: 'cache.invalidate'
 * Payload: { pattern: string }
 * Purpose: Decouples cache clearance logic from controllers
 */
EventBus.on('cache.invalidate', async (payload) => {
    try {
        await invalidateCache(payload.pattern);
        logger.info(`[EVENT] Handled cache.invalidate for ${payload.pattern}`);
    } catch (err) {
        logger.warn(`[EVENT] Failed to clear cache pattern ${payload.pattern}`);
    }
});

/**
 * Event: 'order.created'
 * Payload: { orderId: number, buyerId: number, sellerId: number }
 * Purpose: Acts as a local Kafka/Queue hook. Automatically handles side-effects
 * like clearing caches and triggering confirmation emails asynchronously.
 */
EventBus.on('order.created', async (payload) => {
    logger.info(`[EVENT] order.created received for order: ${payload.orderId}`);
    
    // Abstract cache clears
    EventBus.emit('cache.invalidate', { pattern: 'cache:*/orders*' });
    EventBus.emit('cache.invalidate', { pattern: 'cache:*/reports*' });
    EventBus.emit('cache.invalidate', { pattern: 'cache:*/listings*' });

    try {
        const order = await prisma.order.findUnique({
            where: { id: payload.orderId },
            include: {
                buyer: { select: { name: true } },
                seller: { select: { fcmToken: true } },
                items: {
                    include: {
                        listing: { select: { materialType: true, title: true } }
                    }
                }
            }
        });

        if (!order?.seller?.fcmToken) {
            logger.info(`[EVENT] Seller has no FCM token for order: ${payload.orderId}`);
            return;
        }

        const firstItem = order.items?.[0];
        const itemName = firstItem?.listing?.title || firstItem?.listing?.materialType || 'your product';
        const buyerName = order.buyer?.name || 'A buyer';

        const result = await sendPushNotification({
            token: order.seller.fcmToken,
            title: 'New order received',
            body: `${buyerName} purchased ${itemName}.`,
            data: {
                type: 'ORDER_CREATED',
                orderId: String(order.id),
                buyerId: String(order.buyerId),
                sellerId: String(order.sellerId),
            }
        });

        if (result.success) {
            logger.info(`[EVENT] Push notification sent for order: ${payload.orderId}`);
        }
    } catch (err) {
        logger.warn(`[EVENT] Failed order.created push notification: ${err.message}`);
    }

    // In the future, emit an email command to the background queue natively
    // queueOfflineRequest('SEND_EMAIL', { to: '...', subject: '...' });
});

/**
 * Event: 'listing.created'
 * Payload: { listingId: number, category: string }
 */
EventBus.on('listing.created', async (payload) => {
    logger.info(`[EVENT] listing.created received for listing: ${payload.listingId}`);
    EventBus.emit('cache.invalidate', { pattern: 'cache:*/listings*' });
    EventBus.emit('cache.invalidate', { pattern: 'cache:*/reports*' });
});

// We can mount global error catchers for events to prevent crash loops
EventBus.on('error', (err) => {
    logger.error(`[EVENT_BUS] Uncaught Exception in Event Bus: ${err.message}`);
});
