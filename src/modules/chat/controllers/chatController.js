/**
 * Chat Controller
 *
 * Manages conversations and messages — supports triangular chat flow
 * (Buyer↔Seller + Buyer↔Collector) with real-time WebSocket broadcasting.
 *
 * @module modules/chat/controllers/chatController
 */

import prisma from '../../../lib/prisma.js';
import { sendSuccess, sendError } from '../../../utils/responseHelper.js';
import { logActivity } from '../../../utils/activityLogger.js';
import { getIO, isUserOnline } from '../gateway/socketGateway.js';
import { uploadToCloudinary } from '../../../utils/uploadHelper.js';
import pusher from '../../../lib/pusher.js';
import { logger } from '../../../utils/logger.js';

const PARTICIPANT_SELECT = {
  id: true, name: true, profileImage: true, role: true, businessName: true,
};

/**
 * Get all conversations for the authenticated user.
 * GET /api/chat/conversations
 */
export async function getConversations(req, res) {
  try {
    const userId = req.user.id;

    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [
          { participant1Id: userId },
          { participant2Id: userId },
        ],
      },
      include: {
        participant1: { select: PARTICIPANT_SELECT },
        participant2: { select: PARTICIPANT_SELECT },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true, content: true, createdAt: true,
            isRead: true, senderId: true, messageType: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const formattedConversations = await Promise.all(
      conversations.map(async (conv) => {
        const otherParticipant = conv.participant1Id === userId
          ? conv.participant2 : conv.participant1;
        const lastMessage = conv.messages[0] || null;

        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conv.id,
            senderId: { not: userId },
            isRead: false,
          },
        });

        return {
          id: conv.id,
          type: conv.type,
          orderId: conv.orderId,
          otherParticipant: {
            ...otherParticipant,
            isOnline: await isUserOnline(otherParticipant.id),
          },
          lastMessage,
          unreadCount,
          updatedAt: conv.updatedAt,
        };
      })
    );

    sendSuccess(res, 'Conversations fetched', formattedConversations);
  } catch (err) {
    sendError(res, 'Failed to fetch conversations', err);
  }
}

/**
 * Get or create a conversation between two users.
 * POST /api/chat/conversations
 */
export async function getOrCreateConversation(req, res) {
  try {
    const userId = req.user.id;
    const { otherUserId, orderId, type = "GENERAL" } = req.body;

    if (!otherUserId) return sendError(res, 'otherUserId is required', null, 400);
    if (userId === parseInt(otherUserId)) {
      return sendError(res, 'Cannot create conversation with yourself', null, 400);
    }

    // Check if conversation already exists
    const whereClause = {
      OR: [
        { participant1Id: userId, participant2Id: parseInt(otherUserId) },
        { participant1Id: parseInt(otherUserId), participant2Id: userId },
      ],
    };

    // If orderId provided, scope to that order
    if (orderId) whereClause.orderId = parseInt(orderId);

    let conversation = await prisma.conversation.findFirst({
      where: whereClause,
      include: {
        participant1: { select: PARTICIPANT_SELECT },
        participant2: { select: PARTICIPANT_SELECT },
      },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          participant1Id: userId,
          participant2Id: parseInt(otherUserId),
          orderId: orderId ? parseInt(orderId) : null,
          type,
        },
        include: {
          participant1: { select: PARTICIPANT_SELECT },
          participant2: { select: PARTICIPANT_SELECT },
        },
      });

      // Send a system message
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: userId,
          content: "Conversation started",
          messageType: "SYSTEM",
        },
      });

      await logActivity({
        userId, role: req.user.role, action: "CREATE_CONVERSATION",
        resourceType: "conversation", resourceId: conversation.id,
        meta: { otherUserId, type, orderId }, req,
      });
    }

    const otherParticipant = conversation.participant1Id === userId
      ? conversation.participant2 : conversation.participant1;

    sendSuccess(res, 'Conversation retrieved', {
      id: conversation.id,
      type: conversation.type,
      orderId: conversation.orderId,
      otherParticipant: {
        ...otherParticipant,
        isOnline: await isUserOnline(otherParticipant.id),
      },
    }, 201);
  } catch (err) {
    sendError(res, 'Failed to get or create conversation', err);
  }
}

/**
 * Get messages for a specific conversation with pagination.
 * GET /api/chat/conversations/:conversationId/messages
 */
export async function getMessages(req, res) {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: parseInt(conversationId),
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
    });

    if (!conversation) return sendError(res, 'Conversation not found', null, 404);

    const messages = await prisma.message.findMany({
      where: { conversationId: parseInt(conversationId) },
      include: {
        sender: { select: { id: true, name: true, profileImage: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    // Mark as read
    await prisma.message.updateMany({
      where: {
        conversationId: parseInt(conversationId),
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true },
    });

    sendSuccess(res, 'Messages fetched', messages.reverse());
  } catch (err) {
    sendError(res, 'Failed to fetch messages', err);
  }
}

/**
 * Send a message via REST (also broadcasts via Socket.io).
 * POST /api/chat/messages
 */
export async function sendMessage(req, res) {
  try {
    const userId = req.user.id;
    const { conversationId, content, imageUrl, voiceUrl, messageType = "TEXT" } = req.body;

    if (!content && !imageUrl && !voiceUrl) {
      return sendError(res, 'Message content, image, or voice note required', null, 400);
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: parseInt(conversationId),
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
    });

    if (!conversation) return sendError(res, 'Conversation not found', null, 404);

    const message = await prisma.message.create({
      data: {
        conversationId: parseInt(conversationId),
        senderId: userId,
        content: content || '',
        imageUrl,
        voiceUrl,
        messageType,
      },
      include: {
        sender: { select: { id: true, name: true, profileImage: true } },
      },
    });

    await prisma.conversation.update({
      where: { id: parseInt(conversationId) },
      data: { updatedAt: new Date() },
    });

    // Broadcast via WebSocket
    const io = getIO();
    if (io) {
      const recipientId = conversation.participant1Id === userId
        ? conversation.participant2Id : conversation.participant1Id;
      io.to(`user:${recipientId}`).emit("message:received", message);
    }

    sendSuccess(res, 'Message sent', message, 201);
  } catch (err) {
    sendError(res, 'Failed to send message', err);
  }
}

/**
 * Upload a voice note file to Cloudinary and return the secure URL.
 * POST /api/chat/voice-message/upload
 */
export async function uploadVoiceMessage(req, res) {
  try {
    const userId = req.user.id;
    if (!req.file) {
      return sendError(res, 'No audio file provided', null, 400);
    }

    // Upload to Cloudinary under folders recyconnect/chat/voice
    const uploadResult = await uploadToCloudinary(req.file, `recyconnect/chat/voice/${userId}`);

    sendSuccess(res, 'Voice message uploaded successfully', {
      voiceUrl: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      duration: uploadResult.duration ? Math.round(uploadResult.duration) : null
    });
  } catch (err) {
    sendError(res, 'Failed to upload voice message', err);
  }
}

/**
 * Get all conversations linked to a specific order (triangular view).
 * GET /api/chat/order/:orderId
 */
export async function getOrderChats(req, res) {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const conversations = await prisma.conversation.findMany({
      where: {
        orderId: parseInt(orderId),
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      include: {
        participant1: { select: PARTICIPANT_SELECT },
        participant2: { select: PARTICIPANT_SELECT },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, content: true, createdAt: true, messageType: true },
        },
      },
      orderBy: { type: 'asc' },
    });

    const formatted = await Promise.all(
      conversations.map(async (conv) => {
        const otherParticipant = conv.participant1Id === userId
          ? conv.participant2 : conv.participant1;
        return {
          id: conv.id,
          type: conv.type,
          otherParticipant: {
            ...otherParticipant,
            isOnline: await isUserOnline(otherParticipant.id),
          },
          lastMessage: conv.messages[0] || null,
        };
      })
    );

    sendSuccess(res, 'Order chats fetched', formatted);
  } catch (err) {
    sendError(res, 'Failed to fetch order chats', err);
  }
}

/**
 * Auto-create a Buyer↔Collector conversation when a collector is assigned.
 * Called internally from the order module, not exposed as an API endpoint.
 *
 * @param {number} orderId - The order ID
 * @param {number} buyerId - The buyer's user ID
 * @param {number} collectorId - The assigned collector's user ID
 * @returns {Promise<object>} The created conversation
 */
export async function autoCreateCollectorChat(orderId, buyerId, collectorId) {
  // Check if conversation already exists
  const existing = await prisma.conversation.findFirst({
    where: {
      orderId,
      type: "BUYER_COLLECTOR",
      OR: [
        { participant1Id: buyerId, participant2Id: collectorId },
        { participant1Id: collectorId, participant2Id: buyerId },
      ],
    },
  });

  if (existing) return existing;

  const conversation = await prisma.conversation.create({
    data: {
      participant1Id: buyerId,
      participant2Id: collectorId,
      orderId,
      type: "BUYER_COLLECTOR",
    },
  });

  // System message
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: collectorId,
      content: "A collector has been assigned for your pickup. You can coordinate details here.",
      messageType: "SYSTEM",
    },
  });

  // Notify buyer via WebSocket
  const io = getIO();
  if (io) {
    io.to(`user:${buyerId}`).emit("chat:new", {
      conversationId: conversation.id,
      type: "BUYER_COLLECTOR",
      orderId,
    });
  }

  return conversation;
}

/**
 * Authorize subscribing clients to Pusher private and presence channels.
 * POST /api/chat/pusher/auth
 */
export async function pusherAuth(req, res) {
  try {
    const { socket_id, channel_name } = req.body;
    const userId = req.user.id;

    if (!pusher) {
      logger.warn('[PUSHER AUTH] Pusher client is not initialized');
      return res.status(500).send('Pusher service is not configured');
    }

    if (!socket_id || !channel_name) {
      return res.status(400).send('socket_id and channel_name are required');
    }

    // 1. Authenticate private user channel
    if (channel_name === `private-user-${userId}`) {
      const auth = pusher.authorizeChannel(socket_id, channel_name);
      return res.json(auth);
    }

    // 2. Authenticate private task channel (live tracking)
    if (channel_name.startsWith('private-task-')) {
      const taskId = parseInt(channel_name.split('-')[2]);
      const task = await prisma.collectorTask.findFirst({
        where: {
          id: taskId,
          OR: [
            { collectorId: userId },
            { warehouseId: userId },
            { sourceUserId: userId },
            { destinationUserId: userId }
          ]
        }
      });
      if (task) {
        const auth = pusher.authorizeChannel(socket_id, channel_name);
        return res.json(auth);
      }
    }

    // 3. Authenticate presence channel
    if (channel_name === 'presence-online') {
      const presenceData = {
        user_id: userId.toString(),
        user_info: {
          id: userId,
          name: req.user.name,
          role: req.user.role,
        }
      };
      const auth = pusher.authorizeChannel(socket_id, channel_name, presenceData);
      return res.json(auth);
    }

    logger.warn(`[PUSHER AUTH] Access denied for user ${userId} to channel ${channel_name}`);
    return res.status(403).send('Forbidden: Access denied to this channel');
  } catch (err) {
    logger.error('[PUSHER AUTH] Error:', err.message);
    res.status(500).send('Internal Server Error');
  }
}

