import prisma from '../../../lib/prisma.js';
import { sendSuccess, sendError } from '../../../utils/responseHelper.js';
import { logger } from '../../../utils/logger.js';

/**
 * Fetch all notifications for the authenticated user
 * GET /api/notifications
 */
export async function getUserNotifications(req, res) {
  try {
    const userId = req.user.id;

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    sendSuccess(res, 'Notifications fetched successfully', notifications);
  } catch (err) {
    logger.error(`[NOTIFICATION CONTROLLER] Fetch failed: ${err.message}`);
    sendError(res, 'Failed to fetch notifications', err);
  }
}

/**
 * Mark a specific notification as read
 * PATCH /api/notifications/:id/read
 */
export async function markAsRead(req, res) {
  try {
    const userId = req.user.id;
    const notificationId = parseInt(req.params.id, 10);

    if (isNaN(notificationId)) {
      return sendError(res, 'Invalid notification ID', null, 400);
    }

    // Verify ownership
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      return sendError(res, 'Notification not found', null, 404);
    }

    const updatedNotification = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    sendSuccess(res, 'Notification marked as read', updatedNotification);
  } catch (err) {
    logger.error(`[NOTIFICATION CONTROLLER] Mark read failed: ${err.message}`);
    sendError(res, 'Failed to mark notification as read', err);
  }
}

/**
 * Mark all notifications as read for the authenticated user
 * PATCH /api/notifications/read-all
 */
export async function markAllAsRead(req, res) {
  try {
    const userId = req.user.id;

    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    sendSuccess(res, 'All notifications marked as read', { count: result.count });
  } catch (err) {
    logger.error(`[NOTIFICATION CONTROLLER] Mark all read failed: ${err.message}`);
    sendError(res, 'Failed to mark all notifications as read', err);
  }
}

/**
 * Delete a specific notification
 * DELETE /api/notifications/:id
 */
export async function deleteNotification(req, res) {
  try {
    const userId = req.user.id;
    const notificationId = parseInt(req.params.id, 10);

    if (isNaN(notificationId)) {
      return sendError(res, 'Invalid notification ID', null, 400);
    }

    // Verify ownership
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      return sendError(res, 'Notification not found', null, 404);
    }

    await prisma.notification.delete({
      where: { id: notificationId },
    });

    sendSuccess(res, 'Notification deleted successfully');
  } catch (err) {
    logger.error(`[NOTIFICATION CONTROLLER] Delete failed: ${err.message}`);
    sendError(res, 'Failed to delete notification', err);
  }
}

/**
 * Clear all notifications for the authenticated user
 * DELETE /api/notifications
 */
export async function clearAllNotifications(req, res) {
  try {
    const userId = req.user.id;

    const result = await prisma.notification.deleteMany({
      where: { userId },
    });

    sendSuccess(res, 'All notifications cleared successfully', { count: result.count });
  } catch (err) {
    logger.error(`[NOTIFICATION CONTROLLER] Clear all failed: ${err.message}`);
    sendError(res, 'Failed to clear notifications', err);
  }
}
