import { PrismaClient } from '@prisma/client';
import { sendSuccess, sendError } from '../utils/responseHelper.js';

const prisma = new PrismaClient();

/**
 * Get all conversations for the authenticated user
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
                participant1: {
                    select: { id: true, name: true, profileImage: true, role: true, businessName: true }
                },
                participant2: {
                    select: { id: true, name: true, profileImage: true, role: true, businessName: true }
                },
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: {
                        id: true,
                        content: true,
                        createdAt: true,
                        isRead: true,
                        senderId: true,
                    }
                },
            },
            orderBy: { updatedAt: 'desc' },
        });

        // Format conversations with the other participant's info
        const formattedConversations = conversations.map(conv => {
            const otherParticipant = conv.participant1Id === userId ? conv.participant2 : conv.participant1;
            const lastMessage = conv.messages[0] || null;
            const unreadCount = lastMessage && !lastMessage.isRead && lastMessage.senderId !== userId ? 1 : 0;

            return {
                id: conv.id,
                otherParticipant,
                lastMessage,
                unreadCount,
                updatedAt: conv.updatedAt,
            };
        });

        sendSuccess(res, 'Conversations fetched', formattedConversations);
    } catch (err) {
        sendError(res, 'Failed to fetch conversations', err);
    }
}

/**
 * Get or create a conversation between two users
 */
export async function getOrCreateConversation(req, res) {
    try {
        const userId = req.user.id;
        const { otherUserId } = req.body;

        if (!otherUserId) {
            return sendError(res, 'otherUserId is required', null, 400);
        }

        if (userId === parseInt(otherUserId)) {
            return sendError(res, 'Cannot create conversation with yourself', null, 400);
        }

        // Check if conversation already exists (both directions)
        let conversation = await prisma.conversation.findFirst({
            where: {
                OR: [
                    { participant1Id: userId, participant2Id: parseInt(otherUserId) },
                    { participant1Id: parseInt(otherUserId), participant2Id: userId },
                ],
            },
            include: {
                participant1: {
                    select: { id: true, name: true, profileImage: true, role: true, businessName: true }
                },
                participant2: {
                    select: { id: true, name: true, profileImage: true, role: true, businessName: true }
                },
            },
        });

        // Create if doesn't exist
        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    participant1Id: userId,
                    participant2Id: parseInt(otherUserId),
                },
                include: {
                    participant1: {
                        select: { id: true, name: true, profileImage: true, role: true, businessName: true }
                    },
                    participant2: {
                        select: { id: true, name: true, profileImage: true, role: true, businessName: true }
                    },
                },
            });
        }

        const otherParticipant = conversation.participant1Id === userId
            ? conversation.participant2
            : conversation.participant1;

        sendSuccess(res, 'Conversation retrieved', {
            id: conversation.id,
            otherParticipant,
        }, 201);
    } catch (err) {
        sendError(res, 'Failed to get or create conversation', err);
    }
}

/**
 * Get messages for a specific conversation
 */
export async function getMessages(req, res) {
    try {
        const userId = req.user.id;
        const { conversationId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        // Verify user is participant
        const conversation = await prisma.conversation.findFirst({
            where: {
                id: parseInt(conversationId),
                OR: [
                    { participant1Id: userId },
                    { participant2Id: userId },
                ],
            },
        });

        if (!conversation) {
            return sendError(res, 'Conversation not found', null, 404);
        }

        const messages = await prisma.message.findMany({
            where: { conversationId: parseInt(conversationId) },
            include: {
                sender: {
                    select: { id: true, name: true, profileImage: true }
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
        });

        // Mark messages as read
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
 * Send a message (called via HTTP, but real-time is handled by Socket.io)
 */
export async function sendMessage(req, res) {
    try {
        const userId = req.user.id;
        const { conversationId, content, imageUrl } = req.body;

        if (!content && !imageUrl) {
            return sendError(res, 'Message content or image required', null, 400);
        }

        // Verify user is participant
        const conversation = await prisma.conversation.findFirst({
            where: {
                id: parseInt(conversationId),
                OR: [
                    { participant1Id: userId },
                    { participant2Id: userId },
                ],
            },
        });

        if (!conversation) {
            return sendError(res, 'Conversation not found', null, 404);
        }

        const message = await prisma.message.create({
            data: {
                conversationId: parseInt(conversationId),
                senderId: userId,
                content: content || '',
                imageUrl,
            },
            include: {
                sender: {
                    select: { id: true, name: true, profileImage: true }
                },
            },
        });

        // Update conversation timestamp
        await prisma.conversation.update({
            where: { id: parseInt(conversationId) },
            data: { updatedAt: new Date() },
        });

        sendSuccess(res, 'Message sent', message, 201);
    } catch (err) {
        sendError(res, 'Failed to send message', err);
    }
}
