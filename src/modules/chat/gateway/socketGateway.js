/**
 * Socket.io Gateway
 *
 * Real-time WebSocket server for chat messaging, typing indicators,
 * read receipts, and online presence tracking.
 *
 * @module modules/chat/gateway/socketGateway
 */

import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import prisma from "../../../lib/prisma.js";
import { initVoiceSignaling } from "./voiceSignaling.js";

/** @type {Server|null} */
let io = null;

/** Track online users: userId → Set<socketId> */
const onlineUsers = new Map();

/**
 * Initialize Socket.io on the existing HTTP server.
 *
 * @param {import('http').Server} httpServer - Node HTTP server instance
 * @returns {Server} The Socket.io server instance
 */
export function initSocketGateway(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL
        ? process.env.FRONTEND_URL.split(",")
        : ["http://localhost:3000", "http://localhost:5173"],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // ── JWT Authentication Middleware ─────────────────────────
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace("Bearer ", "");

    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id || decoded.userId;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      next(new Error("Invalid or expired token"));
    }
  });

  // ── Connection Handler ────────────────────────────────────
  io.on("connection", (socket) => {
    const userId = socket.userId;
    console.log(`[WS] User ${userId} connected (${socket.id})`);

    // Track online status (one user can have multiple devices)
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    // Join personal room for targeted messages
    socket.join(`user:${userId}`);

    // Broadcast online status
    socket.broadcast.emit("user:online", { userId });

    // ── Chat Events ───────────────────────────────────────
    socket.on("message:send", (data) => handleSendMessage(socket, data));
    socket.on("message:read", (data) => handleReadReceipt(socket, data));
    socket.on("typing:start", (data) => handleTyping(socket, data, true));
    socket.on("typing:stop", (data) => handleTyping(socket, data, false));
    socket.on("user:status", () => handleStatusCheck(socket));

    // ── Collector Live Tracking ──────────────────────────
    socket.on("collector:track", (data) => {
      const { taskId } = data;
      if (taskId) {
        socket.join(`task:${taskId}`);
        console.log(`[WS] User ${userId} tracking task ${taskId}`);
      }
    });

    socket.on("collector:untrack", (data) => {
      const { taskId } = data;
      if (taskId) {
        socket.leave(`task:${taskId}`);
        console.log(`[WS] User ${userId} stopped tracking task ${taskId}`);
      }
    });

    // ── Disconnect ────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[WS] User ${userId} disconnected (${socket.id})`);
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          socket.broadcast.emit("user:offline", { userId });
        }
      }
    });
  });

  // Mount voice signaling on the same io instance
  initVoiceSignaling(io);

  console.log("[WS] Socket.io gateway initialized");
  return io;
}

/**
 * Get the Socket.io server instance (for use in REST controllers).
 * @returns {Server|null}
 */
export function getIO() {
  return io;
}

/**
 * Check if a user is currently online.
 * @param {number} userId
 * @returns {boolean}
 */
export function isUserOnline(userId) {
  return onlineUsers.has(userId);
}

// ── Event Handlers ──────────────────────────────────────────

/**
 * Handle real-time message sending.
 * Saves to DB then broadcasts to the other participant.
 */
async function handleSendMessage(socket, data) {
  try {
    const { conversationId, content, imageUrl, voiceUrl, messageType = "TEXT" } = data;
    const senderId = socket.userId;

    if (!conversationId || (!content && !imageUrl && !voiceUrl)) {
      return socket.emit("error", { message: "conversationId and content/media required" });
    }

    // Verify sender is a participant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: parseInt(conversationId),
        OR: [
          { participant1Id: senderId },
          { participant2Id: senderId },
        ],
      },
    });

    if (!conversation) {
      return socket.emit("error", { message: "Conversation not found" });
    }

    // Save message to DB
    const message = await prisma.message.create({
      data: {
        conversationId: parseInt(conversationId),
        senderId,
        content: content || "",
        imageUrl: imageUrl || null,
        voiceUrl: voiceUrl || null,
        messageType,
      },
      include: {
        sender: { select: { id: true, name: true, profileImage: true } },
      },
    });

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id: parseInt(conversationId) },
      data: { updatedAt: new Date() },
    });

    // Determine the other participant
    const recipientId =
      conversation.participant1Id === senderId
        ? conversation.participant2Id
        : conversation.participant1Id;

    // Emit to both sender (confirmation) and recipient
    socket.emit("message:sent", message);
    io.to(`user:${recipientId}`).emit("message:received", message);
  } catch (err) {
    console.error("[WS] message:send error:", err);
    socket.emit("error", { message: "Failed to send message" });
  }
}

/**
 * Handle read receipts — marks all unread messages in a conversation as read.
 */
async function handleReadReceipt(socket, data) {
  try {
    const { conversationId } = data;
    const userId = socket.userId;

    const updated = await prisma.message.updateMany({
      where: {
        conversationId: parseInt(conversationId),
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true },
    });

    if (updated.count > 0) {
      // Notify the other participant that their messages were read
      const conversation = await prisma.conversation.findUnique({
        where: { id: parseInt(conversationId) },
      });

      const recipientId =
        conversation.participant1Id === userId
          ? conversation.participant2Id
          : conversation.participant1Id;

      io.to(`user:${recipientId}`).emit("message:read", {
        conversationId: parseInt(conversationId),
        readBy: userId,
        count: updated.count,
      });
    }
  } catch (err) {
    console.error("[WS] message:read error:", err);
  }
}

/**
 * Handle typing indicators.
 */
function handleTyping(socket, data, isTyping) {
  const { conversationId, recipientId } = data;
  if (recipientId) {
    io.to(`user:${recipientId}`).emit(isTyping ? "typing:start" : "typing:stop", {
      conversationId,
      userId: socket.userId,
    });
  }
}

/**
 * Return online user list to the requesting socket.
 */
function handleStatusCheck(socket) {
  const onlineList = Array.from(onlineUsers.keys());
  socket.emit("user:status", { online: onlineList });
}
