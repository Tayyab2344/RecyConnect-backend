import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let io;

/**
 * Initialize Socket.io server
 */
export function initializeSocket(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: process.env.FRONTEND_URL || '*',
            methods: ['GET', 'POST'],
        },
    });

    // Authentication middleware
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;

            if (!token) {
                return next(new Error('Authentication error: No token provided'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.id;
            next();
        } catch (err) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    // Connection handler
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.userId}`);

        // Join user to their personal room
        socket.join(`user:${socket.userId}`);

        // Join conversation room
        socket.on('join_conversation', (conversationId) => {
            socket.join(`conversation:${conversationId}`);
            console.log(`User ${socket.userId} joined conversation ${conversationId}`);
        });

        // Leave conversation room
        socket.on('leave_conversation', (conversationId) => {
            socket.leave(`conversation:${conversationId}`);
            console.log(`User ${socket.userId} left conversation ${conversationId}`);
        });

        // Send message
        socket.on('send_message', async (data) => {
            try {
                const { conversationId, content, imageUrl } = data;

                // Verify user is participant
                const conversation = await prisma.conversation.findFirst({
                    where: {
                        id: parseInt(conversationId),
                        OR: [
                            { participant1Id: socket.userId },
                            { participant2Id: socket.userId },
                        ],
                    },
                });

                if (!conversation) {
                    socket.emit('error', { message: 'Conversation not found' });
                    return;
                }

                // Create message
                const message = await prisma.message.create({
                    data: {
                        conversationId: parseInt(conversationId),
                        senderId: socket.userId,
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

                // Emit to all users in the conversation
                io.to(`conversation:${conversationId}`).emit('new_message', message);

                // Also emit to the other participant's personal room (for notifications)
                const otherUserId = conversation.participant1Id === socket.userId
                    ? conversation.participant2Id
                    : conversation.participant1Id;

                io.to(`user:${otherUserId}`).emit('new_conversation_message', {
                    conversationId,
                    message,
                });
            } catch (err) {
                console.error('Error sending message:', err);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        // Typing indicator
        socket.on('typing', (data) => {
            const { conversationId, isTyping } = data;
            socket.to(`conversation:${conversationId}`).emit('user_typing', {
                userId: socket.userId,
                isTyping,
            });
        });

        // Mark messages as read
        socket.on('mark_read', async (data) => {
            try {
                const { conversationId } = data;

                await prisma.message.updateMany({
                    where: {
                        conversationId: parseInt(conversationId),
                        senderId: { not: socket.userId },
                        isRead: false,
                    },
                    data: { isRead: true },
                });

                socket.to(`conversation:${conversationId}`).emit('messages_read', {
                    conversationId,
                    userId: socket.userId,
                });
            } catch (err) {
                console.error('Error marking messages as read:', err);
            }
        });

        // Disconnect handler
        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.userId}`);
        });
    });

    return io;
}

/**
 * Get Socket.io instance
 */
export function getIO() {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
}
