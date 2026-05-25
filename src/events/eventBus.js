import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { invalidateCache } from '../lib/redis.js';
import { queueOfflineRequest } from '../lib/queueManager.js';
import prisma from '../lib/prisma.js';
import { createAndSendNotification } from '../services/notificationService.js';
import { sendKafkaEvent, registerKafkaEventHandler, isKafkaHealthy } from '../lib/kafka.js';


// Central Event Bus Node
class SystemEventBus extends EventEmitter {}

export const EventBus = new SystemEventBus();

// Register the handler to consume events from Kafka and execute them locally
registerKafkaEventHandler(async (type, payload) => {
    logger.info(`[EVENT_BUS] Consumed Kafka event: ${type}`);
    EventBus.emit(type, { ...payload, __fromKafka: true });
});

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
    // If not from Kafka and Kafka is healthy, route to Kafka and stop local processing
    if (!payload.__fromKafka && isKafkaHealthy()) {
        const success = await sendKafkaEvent('order.created', payload);
        if (success) {
            logger.info(`[EVENT_BUS] order.created event routed via Kafka.`);
            return;
        }
        logger.warn(`[EVENT_BUS] Kafka publish failed. Falling back to local execution for order.created.`);
    }

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

        const firstItem = order.items?.[0];
        const itemName = firstItem?.listing?.title || firstItem?.listing?.materialType || 'your product';
        const buyerName = order.buyer?.name || 'A buyer';

        await createAndSendNotification({
            userId: order.sellerId,
            title: 'New order received',
            message: `${buyerName} purchased ${itemName}.`,
            type: 'ORDER',
            priority: 'HIGH',
            actionUrl: `/orders/${order.id}`,
        });
    } catch (err) {
        logger.warn(`[EVENT] Failed order.created notification dispatch: ${err.message}`);
    }

    // In the future, emit an email command to the background queue natively
    // queueOfflineRequest('SEND_EMAIL', { to: '...', subject: '...' });
});

EventBus.on('listing.created', async (payload) => {
    // If not from Kafka and Kafka is healthy, route to Kafka and stop local processing
    if (!payload.__fromKafka && isKafkaHealthy()) {
        const success = await sendKafkaEvent('listing.created', payload);
        if (success) {
            logger.info(`[EVENT_BUS] listing.created event routed via Kafka.`);
            return;
        }
        logger.warn(`[EVENT_BUS] Kafka publish failed. Falling back to local execution for listing.created.`);
    }

    logger.info(`[EVENT] listing.created received for listing: ${payload.listingId}`);
    EventBus.emit('cache.invalidate', { pattern: 'cache:*/listings*' });
    EventBus.emit('cache.invalidate', { pattern: 'cache:*/reports*' });

    // Award Eco Points to listing owner
    try {
        const { awardPoints } = await import('../services/rewardService.js');
        const listing = await prisma.listing.findUnique({
            where: { id: payload.listingId },
            select: { userId: true, metadata: true }
        });

        if (listing) {
            const isAiClassified = listing.metadata && listing.metadata.aiClassification;
            await awardPoints({
                userId: listing.userId,
                activityType: isAiClassified ? 'AI_CLASSIFICATION' : 'LISTING_UPLOAD'
            });
        }
    } catch (err) {
        logger.error(`[EVENT] Failed to award points on listing.created: ${err.message}`);
    }
});

/**
 * Event: 'order.completed'
 * Payload: { orderId: number, buyerId: number, sellerId: number }
 */
EventBus.on('order.completed', async (payload) => {
    // If not from Kafka and Kafka is healthy, route to Kafka and stop local processing
    if (!payload.__fromKafka && isKafkaHealthy()) {
        const success = await sendKafkaEvent('order.completed', payload);
        if (success) {
            logger.info(`[EVENT_BUS] order.completed event routed via Kafka.`);
            return;
        }
        logger.warn(`[EVENT_BUS] Kafka publish failed. Falling back to local execution for order.completed.`);
    }

    logger.info(`[EVENT] order.completed received for order: ${payload.orderId}`);
    EventBus.emit('cache.invalidate', { pattern: 'cache:*/orders*' });
    EventBus.emit('cache.invalidate', { pattern: 'cache:*/reports*' });

    try {
        const { awardPoints } = await import('../services/rewardService.js');
        const order = await prisma.order.findUnique({
            where: { id: payload.orderId },
            include: {
                buyer: { select: { role: true } },
                seller: { select: { role: true } },
                items: true,
            }
        });

        if (order) {
            const isBulk = order.totalAmount >= 5000 || (order.items?.[0]?.quantity || 0) >= 50;
            
            // 1. Award points to Seller (Successful Sale)
            const sellerRole = (order.seller?.role || 'individual').toLowerCase();
            let sellerActivity = 'SUCCESSFUL_SALE';
            if (sellerRole === 'warehouse') {
                sellerActivity = 'BULK_SALE';
            } else if (sellerRole === 'company') {
                sellerActivity = isBulk ? 'LARGE_TRANSACTION' : 'CORPORATE_RECYCLING';
            }
            await awardPoints({ userId: order.sellerId, activityType: sellerActivity });

            // 2. Award points to Buyer (Purchase Recyclable)
            const buyerRole = (order.buyer?.role || 'individual').toLowerCase();
            let buyerActivity = 'PURCHASE';
            if (buyerRole === 'warehouse') {
                buyerActivity = 'BULK_PURCHASE';
            } else if (buyerRole === 'company') {
                buyerActivity = 'CORPORATE_RECYCLING';
            }
            await awardPoints({ userId: order.buyerId, activityType: buyerActivity });

            // 3. Fast completion check
            if (sellerRole === 'warehouse' || sellerRole === 'company') {
                const diffMs = order.updatedAt.getTime() - order.createdAt.getTime();
                const diffHours = diffMs / (1000 * 60 * 60);
                if (diffHours <= 24) {
                    await awardPoints({ userId: order.sellerId, activityType: 'FAST_ORDER_COMPLETION' });
                }
            }

            // 4. Referral First Transaction point check
            const checkReferrerBonus = async (userId) => {
                const user = await prisma.user.findUnique({
                    where: { id: userId },
                    select: { id: true, referredById: true }
                });
                if (user?.referredById) {
                    const ordersCount = await prisma.order.count({
                        where: {
                            OR: [
                                { buyerId: userId },
                                { sellerId: userId }
                            ],
                            status: 'COMPLETED'
                        }
                    });
                    if (ordersCount === 1) {
                        await awardPoints({
                            userId: user.referredById,
                            activityType: 'REFERRAL',
                            customPoints: 100
                        });
                    }
                }
            };

            await checkReferrerBonus(order.sellerId);
            await checkReferrerBonus(order.buyerId);
        }
    } catch (err) {
        logger.error(`[EVENT] Failed to award points on order.completed: ${err.message}`);
    }
});

// We can mount global error catchers for events to prevent crash loops
EventBus.on('error', (err) => {
    logger.error(`[EVENT_BUS] Uncaught Exception in Event Bus: ${err.message}`);
});
