import express from 'express';
import {
    getConversations,
    getOrCreateConversation,
    getMessages,
    sendMessage,
} from '../controllers/chatController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';

import express from 'express';
import {
    getConversations,
    getOrCreateConversation,
    getMessages,
    sendMessage,
} from '../controllers/chatController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Get all conversations for user
router.get('/conversations', authenticateToken, getConversations);

// Create or get conversation with another user
router.post('/conversations', authenticateToken, getOrCreateConversation);

// Get messages for a conversation
router.get('/conversations/:conversationId/messages', authenticateToken, getMessages);

// Send a message
router.post('/messages', authenticateToken, sendMessage);

export default router;
