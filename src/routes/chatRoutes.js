import express from 'express';
import {
    getConversations,
    getOrCreateConversation,
    getMessages,
    sendMessage,
} from '../controllers/chatController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Real-time messaging between users
 */

/**
 * @swagger
 * /api/chat/conversations:
 *   get:
 *     summary: Get all conversations for current user
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of conversations
 *   post:
 *     summary: Create or get a conversation with another user
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participantId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Conversation object
 */
router.get('/conversations', authenticateToken, getConversations);
router.post('/conversations', authenticateToken, getOrCreateConversation);

/**
 * @swagger
 * /api/chat/conversations/{conversationId}/messages:
 *   get:
 *     summary: Get messages for a conversation
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of messages
 */
router.get('/conversations/:conversationId/messages', authenticateToken, getMessages);

/**
 * @swagger
 * /api/chat/messages:
 *   post:
 *     summary: Send a new message
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               conversationId:
 *                 type: integer
 *               content:
 *                 type: string
 *     responses:
 *       201:
 *         description: Message sent
 */
router.post('/messages', authenticateToken, sendMessage);

export default router;
