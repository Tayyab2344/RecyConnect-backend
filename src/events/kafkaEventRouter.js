/**
 * Kafka Event Router
 *
 * Maps incoming Kafka event types to their handler functions.
 * Registers a single event handler with the Kafka consumer so that
 * consumed messages are actually processed instead of discarded.
 *
 * @module events/kafkaEventRouter
 */

import { registerKafkaEventHandler } from '../lib/kafka.js';
import { createAndSendNotification } from '../services/notificationService.js';
import { logger } from '../utils/logger.js';

/**
 * Event type → handler mapping.
 * Each handler receives the event payload object.
 */
const eventHandlers = {
  ORDER_CREATED: async (payload) => {
    logger.info(`[KAFKA-ROUTER] Processing ORDER_CREATED for order ${payload.orderId}`);
    if (payload.sellerId) {
      await createAndSendNotification({
        userId: payload.sellerId,
        title: 'New Order Received',
        message: `You have a new order #${payload.orderId} to review.`,
        type: 'ORDER',
        priority: 'HIGH',
        actionUrl: `/orders/${payload.orderId}`,
      });
    }
  },

  ORDER_STATUS_CHANGED: async (payload) => {
    logger.info(`[KAFKA-ROUTER] Processing ORDER_STATUS_CHANGED: ${payload.orderId} → ${payload.status}`);
    if (payload.buyerId) {
      await createAndSendNotification({
        userId: payload.buyerId,
        title: 'Order Status Updated',
        message: `Your order #${payload.orderId} is now ${payload.status}.`,
        type: 'ORDER',
        priority: 'MEDIUM',
        actionUrl: `/orders/${payload.orderId}`,
      });
    }
  },

  LISTING_SOLD: async (payload) => {
    logger.info(`[KAFKA-ROUTER] Processing LISTING_SOLD for listing ${payload.listingId}`);
    if (payload.sellerId) {
      await createAndSendNotification({
        userId: payload.sellerId,
        title: 'Listing Sold!',
        message: `Your listing "${payload.title || '#' + payload.listingId}" has been sold.`,
        type: 'LISTING',
        priority: 'HIGH',
        actionUrl: `/listings/${payload.listingId}`,
      });
    }
  },

  KYC_APPROVED: async (payload) => {
    logger.info(`[KAFKA-ROUTER] Processing KYC_APPROVED for user ${payload.userId}`);
    if (payload.userId) {
      await createAndSendNotification({
        userId: payload.userId,
        title: 'KYC Approved!',
        message: 'Your identity has been verified. You can now access all features.',
        type: 'KYC',
        priority: 'HIGH',
      });
    }
  },

  KYC_REJECTED: async (payload) => {
    logger.info(`[KAFKA-ROUTER] Processing KYC_REJECTED for user ${payload.userId}`);
    if (payload.userId) {
      await createAndSendNotification({
        userId: payload.userId,
        title: 'KYC Review Update',
        message: payload.reason || 'Your KYC submission requires attention. Please re-submit.',
        type: 'KYC',
        priority: 'HIGH',
      });
    }
  },

  PAYMENT_COMPLETED: async (payload) => {
    logger.info(`[KAFKA-ROUTER] Processing PAYMENT_COMPLETED for order ${payload.orderId}`);
    if (payload.sellerId) {
      await createAndSendNotification({
        userId: payload.sellerId,
        title: 'Payment Received',
        message: `Payment of PKR ${payload.amount} for order #${payload.orderId} has been completed.`,
        type: 'PAYMENT',
        priority: 'HIGH',
        actionUrl: `/orders/${payload.orderId}`,
      });
    }
  },
};

/**
 * Initialize the Kafka event router.
 * Registers a single handler that dispatches events to the correct handler function.
 */
export function initKafkaEventRouter() {
  registerKafkaEventHandler(async (type, payload) => {
    const handler = eventHandlers[type];
    if (handler) {
      try {
        await handler(payload);
        logger.info(`[KAFKA-ROUTER] Successfully processed event: ${type}`);
      } catch (err) {
        logger.error(`[KAFKA-ROUTER] Handler error for ${type}: ${err.message}`);
      }
    } else {
      logger.warn(`[KAFKA-ROUTER] No handler registered for event type: ${type}`);
    }
  });

  logger.info('[KAFKA-ROUTER] Event router initialized with handlers: ' +
    Object.keys(eventHandlers).join(', '));
}
