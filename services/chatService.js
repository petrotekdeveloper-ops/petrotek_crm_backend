const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/users');
const ChatConversation = require('../models/chatConversation');
const ChatMessage = require('../models/chatMessage');

class ChatError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseBearerToken(header) {
  if (typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function buildActorKey(actorType, userId) {
  return actorType === 'admin' ? 'admin' : `user:${String(userId)}`;
}

function toParticipantFromActor(actor) {
  return {
    actorType: actor.actorType,
    userId: actor.actorType === 'user' ? actor.user._id : null,
    actorKey: actor.actorKey,
  };
}

function buildDirectParticipantKey(actorA, actorB) {
  return [actorA.actorKey, actorB.actorKey].sort().join('|');
}

async function resolveActorFromToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new ChatError(500, 'Server configuration error');
  if (!token) throw new ChatError(401, 'Unauthorized');

  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch {
    throw new ChatError(401, 'Invalid or expired token');
  }

  if (payload.role === 'admin') {
    return {
      actorType: 'admin',
      actorKey: 'admin',
      role: 'admin',
      user: null,
      payload,
    };
  }

  if (payload.role !== 'user') {
    throw new ChatError(403, 'Forbidden');
  }

  const user = await User.findById(payload.sub).select(
    '_id name designation managerId approvalStatus phone'
  );
  if (!user) {
    throw new ChatError(401, 'Unauthorized');
  }
  if ((user.approvalStatus ?? 'approved') !== 'approved') {
    throw new ChatError(403, 'Account is not active');
  }
  if (!['manager', 'sales'].includes(user.designation)) {
    throw new ChatError(403, 'Chat is only available for manager and sales users');
  }

  return {
    actorType: 'user',
    actorKey: buildActorKey('user', user._id),
    role: 'user',
    user,
    payload,
  };
}

async function resolveTargetActor(actor, body) {
  const targetType = String(body?.targetType || '').trim();
  const targetUserIdRaw = body?.targetUserId;
  const targetUserId =
    targetUserIdRaw == null ? '' : String(targetUserIdRaw).trim();

  if (targetType === 'admin') {
    if (actor.actorType === 'admin') {
      throw new ChatError(400, 'Admin cannot create a direct chat with admin');
    }
    return {
      actorType: 'admin',
      actorKey: 'admin',
      role: 'admin',
      user: null,
    };
  }

  if (!targetUserId || !mongoose.isValidObjectId(targetUserId)) {
    throw new ChatError(
      400,
      'Provide targetType=admin or a valid targetUserId'
    );
  }

  const user = await User.findById(targetUserId).select(
    '_id name designation managerId approvalStatus phone'
  );
  if (!user) throw new ChatError(404, 'Target user not found');
  if ((user.approvalStatus ?? 'approved') !== 'approved') {
    throw new ChatError(403, 'Target user is not active');
  }
  if (!['manager', 'sales'].includes(user.designation)) {
    throw new ChatError(403, 'Target user is not eligible for chat');
  }

  const target = {
    actorType: 'user',
    actorKey: buildActorKey('user', user._id),
    role: 'user',
    user,
  };

  if (actor.actorKey === target.actorKey) {
    throw new ChatError(400, 'You cannot create a conversation with yourself');
  }

  return target;
}

function isManagerSalesPair(actorA, actorB) {
  const pair = [actorA?.user?.designation, actorB?.user?.designation]
    .filter(Boolean)
    .sort()
    .join('|');
  return pair === 'manager|sales';
}

function hasManagerSalesRelationship(actorA, actorB) {
  if (!isManagerSalesPair(actorA, actorB)) return false;
  const manager =
    actorA.user.designation === 'manager' ? actorA.user : actorB.user;
  const sales = actorA.user.designation === 'sales' ? actorA.user : actorB.user;
  return String(sales.managerId) === String(manager._id);
}

function isAdminAndEligibleUser(actorA, actorB) {
  if (actorA.actorType === 'admin' && actorB.actorType === 'user') {
    return ['manager', 'sales'].includes(actorB.user.designation);
  }
  if (actorB.actorType === 'admin' && actorA.actorType === 'user') {
    return ['manager', 'sales'].includes(actorA.user.designation);
  }
  return false;
}

function assertDirectPairAllowed(actorA, actorB) {
  if (isAdminAndEligibleUser(actorA, actorB)) return;
  if (actorA.actorType === 'user' && actorB.actorType === 'user') {
    if (hasManagerSalesRelationship(actorA, actorB)) return;
  }
  throw new ChatError(403, 'This chat pair is not allowed by role policy');
}

async function createOrGetDirectConversation(actor, targetActor) {
  assertDirectPairAllowed(actor, targetActor);
  const participantKey = buildDirectParticipantKey(actor, targetActor);

  const existing = await ChatConversation.findOne({ participantKey });
  if (existing) return existing;

  try {
    return await ChatConversation.create({
      type: 'direct',
      participants: [
        toParticipantFromActor(actor),
        toParticipantFromActor(targetActor),
      ],
      participantKey,
      lastMessageText: '',
      lastMessageAt: null,
      lastMessageSenderKey: '',
    });
  } catch (err) {
    if (err?.code === 11000) {
      const winner = await ChatConversation.findOne({ participantKey });
      if (winner) return winner;
    }
    throw err;
  }
}

function actorInConversation(actor, conversation) {
  return conversation.participants.some((p) => p.actorKey === actor.actorKey);
}

async function assertActorCanAccessConversation(actor, conversation) {
  if (!actorInConversation(actor, conversation)) {
    throw new ChatError(403, 'Forbidden');
  }

  if (conversation.type !== 'direct' || conversation.participants.length !== 2) {
    throw new ChatError(500, 'Invalid conversation state');
  }

  const resolvedParticipants = await Promise.all(
    conversation.participants.map(async (p) => {
      if (p.actorType === 'admin') {
        return {
          actorType: 'admin',
          actorKey: 'admin',
          role: 'admin',
          user: null,
        };
      }

      const user = await User.findById(p.userId).select(
        '_id name designation managerId approvalStatus phone'
      );
      if (!user) throw new ChatError(403, 'Conversation participant not found');
      if ((user.approvalStatus ?? 'approved') !== 'approved') {
        throw new ChatError(403, 'Conversation participant is inactive');
      }
      if (!['manager', 'sales'].includes(user.designation)) {
        throw new ChatError(403, 'Conversation participant is not eligible');
      }
      return {
        actorType: 'user',
        actorKey: buildActorKey('user', user._id),
        role: 'user',
        user,
      };
    })
  );

  assertDirectPairAllowed(resolvedParticipants[0], resolvedParticipants[1]);
}

async function getConversationForActorOrThrow(actor, conversationId) {
  if (!mongoose.isValidObjectId(conversationId)) {
    throw new ChatError(400, 'Invalid conversation id');
  }
  const conversation = await ChatConversation.findById(conversationId);
  if (!conversation) throw new ChatError(404, 'Conversation not found');

  await assertActorCanAccessConversation(actor, conversation);
  return conversation;
}

function normalizeMessageText(text) {
  const value = text == null ? '' : String(text).trim();
  if (!value) throw new ChatError(400, 'Message text is required');
  if (value.length > 1000) throw new ChatError(400, 'Message text is too long');
  return value;
}

async function sendMessageInConversation(actor, conversation, text) {
  const normalizedText = normalizeMessageText(text);

  const readMarker = toParticipantFromActor(actor);
  const message = await ChatMessage.create({
    conversationId: conversation._id,
    sender: toParticipantFromActor(actor),
    senderKey: actor.actorKey,
    text: normalizedText,
    readBy: [readMarker],
    readByKeys: [actor.actorKey],
  });

  conversation.lastMessageText = normalizedText;
  conversation.lastMessageAt = message.createdAt;
  conversation.lastMessageSenderKey = actor.actorKey;
  await conversation.save();

  return message;
}

async function listConversationsForActor(actor) {
  const match =
    actor.actorType === 'admin'
      ? { participants: { $elemMatch: { actorType: 'admin' } } }
      : {
          participants: {
            $elemMatch: {
              actorType: 'user',
              userId: actor.user._id,
            },
          },
        };

  const conversations = await ChatConversation.find(match)
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .lean();

  const userIds = [];
  for (const c of conversations) {
    for (const p of c.participants || []) {
      if (p.actorType === 'user' && p.userId) userIds.push(String(p.userId));
    }
  }

  const uniqueUserIds = [...new Set(userIds)];
  const users = uniqueUserIds.length
    ? await User.find({ _id: { $in: uniqueUserIds } })
        .select('_id name designation phone')
        .lean()
    : [];

  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const conversationIds = conversations.map((c) => c._id);
  const unreadRows =
    conversationIds.length === 0
      ? []
      : await ChatMessage.aggregate([
          {
            $match: {
              conversationId: { $in: conversationIds },
              senderKey: { $ne: actor.actorKey },
              readByKeys: { $ne: actor.actorKey },
            },
          },
          {
            $group: {
              _id: '$conversationId',
              count: { $sum: 1 },
            },
          },
        ]);

  const unreadMap = new Map(
    unreadRows.map((r) => [String(r._id), Number(r.count || 0)])
  );

  return conversations.map((c) => {
    const others = (c.participants || []).filter(
      (p) => p.actorKey !== actor.actorKey
    );
    const other = others[0] || null;

    let counterpart = null;
    if (other?.actorType === 'admin') {
      counterpart = {
        actorType: 'admin',
        actorKey: 'admin',
        displayName: 'Admin',
      };
    } else if (other?.actorType === 'user' && other?.userId) {
      const ref = userMap.get(String(other.userId));
      counterpart = {
        actorType: 'user',
        actorKey: other.actorKey,
        userId: String(other.userId),
        displayName: ref?.name ?? 'Unknown User',
        designation: ref?.designation ?? '',
        phone: ref?.phone ?? '',
      };
    }

    return {
      _id: c._id,
      type: c.type,
      participants: c.participants,
      counterpart,
      lastMessageText: c.lastMessageText || '',
      lastMessageAt: c.lastMessageAt,
      lastMessageSenderKey: c.lastMessageSenderKey || '',
      unreadCount: unreadMap.get(String(c._id)) || 0,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
    };
  });
}

module.exports = {
  ChatError,
  parseBearerToken,
  buildActorKey,
  toParticipantFromActor,
  resolveActorFromToken,
  resolveTargetActor,
  createOrGetDirectConversation,
  getConversationForActorOrThrow,
  sendMessageInConversation,
  listConversationsForActor,
};
