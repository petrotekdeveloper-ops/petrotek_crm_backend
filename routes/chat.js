const express = require('express');
const mongoose = require('mongoose');
const ChatMessage = require('../models/chatMessage');
const {
  ChatError,
  parseBearerToken,
  resolveActorFromToken,
  resolveTargetActor,
  createOrGetDirectConversation,
  getConversationForActorOrThrow,
  sendMessageInConversation,
  listConversationsForActor,
  toParticipantFromActor,
} = require('../services/chatService');

const router = express.Router();

async function requireChatActor(req, res, next) {
  try {
    const token = parseBearerToken(req.headers.authorization);
    req.chatActor = await resolveActorFromToken(token);
    next();
  } catch (err) {
    const status = err instanceof ChatError ? err.status : 500;
    const message =
      err instanceof ChatError ? err.message : 'Failed to authorize chat actor';
    return res.status(status).json({ error: message });
  }
}

function parseLimit(raw, fallback = 30, max = 100) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

function emitConversationUpdated(io, conversation) {
  if (!io) return;
  for (const participant of conversation.participants || []) {
    io.to(`chat:actor:${participant.actorKey}`).emit('chat:conversation:updated', {
      conversationId: conversation._id,
    });
  }
}

router.get('/conversations', requireChatActor, async (req, res) => {
  try {
    const conversations = await listConversationsForActor(req.chatActor);
    return res.json({ conversations });
  } catch {
    return res.status(500).json({ error: 'Failed to list conversations' });
  }
});

router.post('/conversations/direct', requireChatActor, async (req, res) => {
  try {
    const targetActor = await resolveTargetActor(req.chatActor, req.body || {});
    const conversation = await createOrGetDirectConversation(
      req.chatActor,
      targetActor
    );
    return res.status(201).json({ conversation });
  } catch (err) {
    const status = err instanceof ChatError ? err.status : 500;
    const message =
      err instanceof ChatError
        ? err.message
        : 'Failed to create direct conversation';
    return res.status(status).json({ error: message });
  }
});

router.get(
  '/conversations/:conversationId/messages',
  requireChatActor,
  async (req, res) => {
    try {
      const { conversationId } = req.params;
      const conversation = await getConversationForActorOrThrow(
        req.chatActor,
        conversationId
      );

      const limit = parseLimit(req.query?.limit, 30, 100);
      const before = req.query?.before;
      const filter = { conversationId: conversation._id };
      if (before) {
        const beforeDate = new Date(before);
        if (Number.isNaN(beforeDate.getTime())) {
          return res.status(400).json({ error: 'Invalid before timestamp' });
        }
        filter.createdAt = { $lt: beforeDate };
      }

      const rows = await ChatMessage.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();

      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).reverse();
      const nextCursor = hasMore ? rows[limit - 1].createdAt : null;

      return res.json({
        conversationId: conversation._id,
        messages,
        page: {
          limit,
          hasMore,
          nextCursor,
        },
      });
    } catch (err) {
      const status = err instanceof ChatError ? err.status : 500;
      const message =
        err instanceof ChatError ? err.message : 'Failed to list messages';
      return res.status(status).json({ error: message });
    }
  }
);

router.post(
  '/conversations/:conversationId/messages',
  requireChatActor,
  async (req, res) => {
    try {
      const { conversationId } = req.params;
      const conversation = await getConversationForActorOrThrow(
        req.chatActor,
        conversationId
      );
      const message = await sendMessageInConversation(
        req.chatActor,
        conversation,
        req.body?.text
      );

      const io = req.app.get('io');
      if (io) {
        for (const participant of conversation.participants || []) {
          io.to(`chat:actor:${participant.actorKey}`).emit('chat:message:new', {
            conversationId: conversation._id,
            message,
          });
        }
        emitConversationUpdated(io, conversation);
      }

      return res.status(201).json({ message });
    } catch (err) {
      const status = err instanceof ChatError ? err.status : 500;
      const message =
        err instanceof ChatError ? err.message : 'Failed to send message';
      return res.status(status).json({ error: message });
    }
  }
);

router.post(
  '/conversations/:conversationId/read',
  requireChatActor,
  async (req, res) => {
    try {
      const { conversationId } = req.params;
      const conversation = await getConversationForActorOrThrow(
        req.chatActor,
        conversationId
      );

      const actorMarker = toParticipantFromActor(req.chatActor);
      const result = await ChatMessage.updateMany(
        {
          conversationId: conversation._id,
          senderKey: { $ne: req.chatActor.actorKey },
          readByKeys: { $ne: req.chatActor.actorKey },
        },
        {
          $addToSet: {
            readBy: actorMarker,
            readByKeys: req.chatActor.actorKey,
          },
        }
      );

      const io = req.app.get('io');
      if (io) {
        for (const participant of conversation.participants || []) {
          io.to(`chat:actor:${participant.actorKey}`).emit('chat:read:updated', {
            conversationId: conversation._id,
            actorKey: req.chatActor.actorKey,
          });
        }
        emitConversationUpdated(io, conversation);
      }

      return res.json({
        conversationId: conversation._id,
        markedRead: Number(result.modifiedCount || 0),
      });
    } catch (err) {
      const status = err instanceof ChatError ? err.status : 500;
      const message =
        err instanceof ChatError ? err.message : 'Failed to update read status';
      return res.status(status).json({ error: message });
    }
  }
);

router.get('/conversations/:conversationId', requireChatActor, async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation id' });
    }
    const conversation = await getConversationForActorOrThrow(
      req.chatActor,
      conversationId
    );
    return res.json({ conversation });
  } catch (err) {
    const status = err instanceof ChatError ? err.status : 500;
    const message =
      err instanceof ChatError ? err.message : 'Failed to load conversation';
    return res.status(status).json({ error: message });
  }
});

module.exports = router;
