import prisma from '../lib/prisma.js';
import { sendPushNotification } from './firebaseService.js';
import { getIO } from '../modules/chat/gateway/socketGateway.js';
import { logger } from '../utils/logger.js';
import { PriorityQueue } from '../utils/algorithms/priorityQueue.js';

// Map textual priority levels to numbers
const PRIORITY_SCORES = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1
};

// Queue to hold pending dispatch tasks
const dispatchQueue = new PriorityQueue((a, b) => b.priority - a.priority);
let isProcessing = false;

/**
 * Worker function to drain the priority queue asynchronously
 */
async function processDispatchQueue() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    while (!dispatchQueue.isEmpty()) {
      const task = dispatchQueue.dequeue();
      if (!task) continue;

      const { notification, resolve, reject } = task;
      const parsedUserId = notification.userId;

      try {
        // 1. Fetch recipient's registered device FCM token
        const user = await prisma.user.findUnique({
          where: { id: parsedUserId },
          select: { fcmToken: true },
        });

        // 2. Send Push Notification via Firebase (FCM)
        if (user?.fcmToken) {
          const pushResult = await sendPushNotification({
            token: user.fcmToken,
            title: notification.title,
            body: notification.message,
            data: {
              id: String(notification.id),
              type: notification.type,
              priority: notification.priority,
              actionUrl: notification.actionUrl || '',
            },
          });

          if (pushResult.success) {
            logger.info(`[NOTIFICATION WORKER] FCM push successfully sent to user ${parsedUserId}`);
          } else {
            logger.warn(`[NOTIFICATION WORKER] FCM push failed for user ${parsedUserId}: ${pushResult.reason}`);
          }
        } else {
          logger.info(`[NOTIFICATION WORKER] User ${parsedUserId} has no registered FCM token`);
        }

        // 3. Emit a real-time event via WebSocket (Socket.io)
        const io = getIO();
        if (io) {
          io.to(`user:${parsedUserId}`).emit('notification:received', notification);
          logger.info(`[NOTIFICATION WORKER] WebSocket notification emitted to user:${parsedUserId}`);
        } else {
          logger.warn('[NOTIFICATION WORKER] Socket.io gateway is not initialized');
        }

        resolve(notification);
      } catch (err) {
        logger.error(`[NOTIFICATION WORKER] Failed to dispatch task: ${err.message}`);
        reject(err);
      }
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Creates a notification in the database, enqueues it in a Priority Queue based on priority,
 * and processes it asynchronously.
 * 
 * @param {Object} params
 * @param {number} params.userId - Recipient user ID
 * @param {string} params.title - Notification title
 * @param {string} params.message - Notification body/message
 * @param {string} params.type - Category
 * @param {string} [params.priority="MEDIUM"] - HIGH, MEDIUM, LOW
 * @param {string} [params.actionUrl=null] - Deep link URL
 * @returns {Promise<Object|null>} The created notification database record
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

    // 1. Instantly save notification to PostgreSQL database
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

    // 2. Enqueue the dispatch task (FCM + Socket.io) in the Priority Queue
    const priorityVal = PRIORITY_SCORES[priority.toUpperCase()] || 2;
    
    // We run the promise handlers internally or resolve them in the background worker
    new Promise((resolve, reject) => {
      dispatchQueue.enqueue({ notification, resolve, reject }, priorityVal);
    });

    // 3. Trigger worker process loop in background (non-blocking)
    processDispatchQueue().catch(err => {
      logger.error(`[NOTIFICATION] Worker error: ${err.message}`);
    });

    // Return the created database record immediately
    return notification;
  } catch (err) {
    logger.error(`[NOTIFICATION] Failed to enqueue/create notification: ${err.message}`);
    return null;
  }
}
