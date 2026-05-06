const {
  ChatError,
  parseBearerToken,
  resolveActorFromToken,
  getConversationForActorOrThrow,
  sendMessageInConversation,
} = require('../services/chatService');

function initializeChatSocket(io) {
  io.use(async (socket, next) => {
    try {
      const authHeader = socket.handshake?.headers?.authorization;
      const authToken = socket.handshake?.auth?.token;
      const token =
        parseBearerToken(authHeader) ||
        (typeof authToken === 'string' && authToken.trim()
          ? authToken.trim()
          : null);

      const actor = await resolveActorFromToken(token);
      socket.data.chatActor = actor;
      socket.join(`chat:actor:${actor.actorKey}`);
      return next();
    } catch (err) {
      const message =
        err instanceof ChatError ? err.message : 'Socket authentication failed';
      return next(new Error(message));
    }
  });

  io.on('connection', (socket) => {
    socket.on('chat:conversation:join', async (payload = {}, ack) => {
      try {
        const conversation = await getConversationForActorOrThrow(
          socket.data.chatActor,
          payload.conversationId
        );
        socket.join(`chat:conversation:${conversation._id}`);
        if (typeof ack === 'function') {
          ack({ ok: true, conversationId: conversation._id });
        }
      } catch (err) {
        const message =
          err instanceof ChatError ? err.message : 'Failed to join conversation';
        if (typeof ack === 'function') ack({ ok: false, error: message });
      }
    });

    socket.on('chat:message:send', async (payload = {}, ack) => {
      try {
        const conversation = await getConversationForActorOrThrow(
          socket.data.chatActor,
          payload.conversationId
        );
        const message = await sendMessageInConversation(
          socket.data.chatActor,
          conversation,
          payload.text
        );

        for (const participant of conversation.participants || []) {
          io.to(`chat:actor:${participant.actorKey}`).emit('chat:message:new', {
            conversationId: conversation._id,
            message,
          });
          io.to(`chat:actor:${participant.actorKey}`).emit(
            'chat:conversation:updated',
            {
              conversationId: conversation._id,
            }
          );
        }

        if (typeof ack === 'function') {
          ack({ ok: true, conversationId: conversation._id, message });
        }
      } catch (err) {
        const message =
          err instanceof ChatError ? err.message : 'Failed to send message';
        if (typeof ack === 'function') ack({ ok: false, error: message });
      }
    });
  });
}

module.exports = { initializeChatSocket };
