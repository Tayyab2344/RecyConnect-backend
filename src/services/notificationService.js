import prisma from '../lib/prisma.js';
import { sendPushNotification } from './firebaseService.js';
import { getIO } from '../modules/chat/gateway/socketGateway.js';
import { logger } from '../utils/logger.js';

/**
 * Creates a notification in the database, sends a push notification via FCM if available,
 * and emits a Socket.io event for real-time foreground updates.
 * 
 * @param {Object} params
 * @param {number} params.userId - Recipient user ID
 * @param {string} params.title - Notification title
 * @param {string} params.message - Notification body/message
 * @param {string} params.type - Category (ORDER, PAYMENT, CHAT, PICKUP, AI, REWARD, SECURITY, SYSTEM, TRACKING)
 * @param {string} [params.priority="MEDIUM"] - HIGH, MEDIUM, LOW
 * @param {string} [params.actionUrl=null] - Action navigation URL or deep link path
 * @returns {Promise<Object|null>} The created notification object or null if failed
 */
export async function createAndSendNotification({ userId, title, message, type, priority = "MEDIUM", actionUrl = null }) {
  if (!userId) {
    logger.warn('[NOTIFICATION] Cannot create notification: missing userId');
    return null;
  }

  try {
    const parsedUserId = parseInt(userId, 10);
    if (isNaN(parsedUserId)) {
      logger.warn(`[NOTIFICATION] Invalid userId: ${userId}`);
      return null;
    }

    // 1. Save notification to PostgreSQL database
    const notification = await prisma.notification.create({
      data: {
        userId: parsedUserId,
        title,
        message,
        type,
        priority,
        actionUrl,
      },
    });

    // 2. Fetch recipient's registered device FCM token
    const user = await prisma.user.findUnique({
      where: { id: parsedUserId },
      select: { fcmToken: true },
    });

    // 3. Send Push Notification via Firebase (FCM)
    if (user?.fcmToken) {
      const pushResult = await sendPushNotification({
        token: user.fcmToken,
        title,
        body: message,
        data: {
          id: String(notification.id),
          type,
          priority,
          actionUrl: actionUrl || '',
        },
      });

      if (pushResult.success) {
        logger.info(`[NOTIFICATION] FCM push notification successfully sent to user ${parsedUserId}`);
      } else {
        logger.warn(`[NOTIFICATION] FCM push failed for user ${parsedUserId}: ${pushResult.reason}`);
      }
    } else {
      logger.info(`[NOTIFICATION] User ${parsedUserId} has no registered FCM token`);
    }

    // 4. Emit a real-time event via WebSocket (Socket.io)
    const io = getIO();
    if (io) {
      io.to(`user:${parsedUserId}`).emit('notification:received', notification);
      logger.info(`[NOTIFICATION] WebSocket notification emitted to user:${parsedUserId}`);
    } else {
      logger.warn('[NOTIFICATION] Socket.io gateway is not initialized');
    }

    return notification;
  } catch (err) {
    logger.error(`[NOTIFICATION] Failed to dispatch notification: ${err.message}`);
    return null;
  }
}
