/**
 * Voice Call Signaling (WebRTC)
 *
 * Handles WebRTC signaling for 1-to-1 voice calls between users.
 * The backend only relays signaling messages (offer/answer/ICE candidates).
 * Actual audio streams flow peer-to-peer via WebRTC.
 *
 * Flow: Caller → offer → Callee → answer → ICE exchange → Connected
 *
 * @module modules/chat/gateway/voiceSignaling
 */

import prisma from "../../../lib/prisma.js";

/** Track active calls: `${callerId}-${calleeId}` → { state, startedAt } */
const activeCalls = new Map();

/**
 * Mount voice signaling events on the Socket.io server.
 *
 * @param {import('socket.io').Server} io - Socket.io server instance
 */
export function initVoiceSignaling(io) {
  io.on("connection", (socket) => {
    const userId = socket.userId;

    // ── Initiate a Call ───────────────────────────────────
    socket.on("call:initiate", (data) => {
      const { calleeId, conversationId } = data;

      if (!calleeId || !conversationId) {
        return socket.emit("call:error", { message: "calleeId and conversationId required" });
      }

      const callKey = `${userId}-${calleeId}`;
      activeCalls.set(callKey, { state: "ringing", startedAt: Date.now() });

      // Notify the callee
      io.to(`user:${calleeId}`).emit("call:incoming", {
        callerId: userId,
        conversationId,
      });

      console.log(`[VOICE] Call initiated: ${userId} → ${calleeId}`);
    });

    // ── WebRTC Offer (SDP) ────────────────────────────────
    socket.on("call:offer", (data) => {
      const { calleeId, offer } = data;
      io.to(`user:${calleeId}`).emit("call:offer", {
        callerId: userId,
        offer,
      });
    });

    // ── WebRTC Answer (SDP) ───────────────────────────────
    socket.on("call:answer", (data) => {
      const { callerId, answer } = data;

      const callKey = `${callerId}-${userId}`;
      if (activeCalls.has(callKey)) {
        activeCalls.get(callKey).state = "connected";
      }

      io.to(`user:${callerId}`).emit("call:answer", {
        calleeId: userId,
        answer,
      });

      console.log(`[VOICE] Call answered: ${userId} → ${callerId}`);
    });

    // ── ICE Candidate Exchange ────────────────────────────
    socket.on("call:ice-candidate", (data) => {
      const { targetId, candidate } = data;
      io.to(`user:${targetId}`).emit("call:ice-candidate", {
        senderId: userId,
        candidate,
      });
    });

    // ── Reject Call ───────────────────────────────────────
    socket.on("call:reject", (data) => {
      const { callerId } = data;

      const callKey = `${callerId}-${userId}`;
      activeCalls.delete(callKey);

      io.to(`user:${callerId}`).emit("call:rejected", {
        calleeId: userId,
      });

      console.log(`[VOICE] Call rejected: ${userId} ✕ ${callerId}`);
    });

    // ── End Call ──────────────────────────────────────────
    socket.on("call:end", async (data) => {
      const { targetId, conversationId } = data;

      // Find and remove active call (either direction)
      const callKey1 = `${userId}-${targetId}`;
      const callKey2 = `${targetId}-${userId}`;
      const callData = activeCalls.get(callKey1) || activeCalls.get(callKey2);

      let duration = 0;
      if (callData?.startedAt && callData.state === "connected") {
        duration = Math.round((Date.now() - callData.startedAt) / 1000);
      }

      activeCalls.delete(callKey1);
      activeCalls.delete(callKey2);

      // Notify the other user
      io.to(`user:${targetId}`).emit("call:ended", {
        endedBy: userId,
        duration,
      });

      // Log the call as a CALL_LOG message
      if (conversationId && duration > 0) {
        try {
          await prisma.message.create({
            data: {
              conversationId: parseInt(conversationId),
              senderId: userId,
              content: `Voice call — ${formatDuration(duration)}`,
              messageType: "CALL_LOG",
              callDuration: duration,
            },
          });

          await prisma.conversation.update({
            where: { id: parseInt(conversationId) },
            data: { updatedAt: new Date() },
          });
        } catch (err) {
          console.error("[VOICE] Failed to log call:", err);
        }
      }

      console.log(`[VOICE] Call ended: ${userId} ↔ ${targetId} (${duration}s)`);
    });

    // ── Cleanup on Disconnect ─────────────────────────────
    socket.on("disconnect", () => {
      // End any active calls for this user
      for (const [key, call] of activeCalls) {
        const [callerId, calleeId] = key.split("-").map(Number);
        if (callerId === userId || calleeId === userId) {
          const targetId = callerId === userId ? calleeId : callerId;
          io.to(`user:${targetId}`).emit("call:ended", {
            endedBy: userId,
            reason: "disconnected",
          });
          activeCalls.delete(key);
        }
      }
    });
  });

  console.log("[VOICE] WebRTC signaling initialized");
}

/**
 * Format seconds into a human-readable duration string.
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}
