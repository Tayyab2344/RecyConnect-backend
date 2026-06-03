/**
 * Chat Routes
 *
 * REST endpoints for chat — conversations, messages, and order-scoped chats.
 * Real-time messaging is handled by the Socket.io gateway.
 *
 * @module modules/chat/routes/chatRoutes
 */

import express from 'express';
import {
  getConversations,
  getOrCreateConversation,
  getMessages,
  sendMessage,
  getOrderChats,
  uploadVoiceMessage,
  pusherAuth,
} from '../controllers/chatController.js';
import { authenticateToken } from '../../../middlewares/authMiddleware.js';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// All chat routes require authentication
router.use(authenticateToken);

// ── Pusher Channel Authorization ──────────────────────────────
router.post('/pusher/auth', pusherAuth);


// ── Conversations ─────────────────────────────────────────────
router.get('/conversations', getConversations);
router.post('/conversations', getOrCreateConversation);

// ── Messages ──────────────────────────────────────────────────
router.get('/conversations/:conversationId/messages', getMessages);
router.post('/messages', sendMessage);
router.post('/voice-message/upload', upload.single('voice'), uploadVoiceMessage);

// ── Order-scoped Chats (triangular view) ──────────────────────
router.get('/order/:orderId', getOrderChats);

export default router;
