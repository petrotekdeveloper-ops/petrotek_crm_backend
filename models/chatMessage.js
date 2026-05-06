const mongoose = require('mongoose');

const chatActorSchema = new mongoose.Schema(
  {
    actorType: {
      type: String,
      enum: ['admin', 'user'],
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actorKey: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const chatMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatConversation',
      required: true,
      index: true,
    },
    sender: {
      type: chatActorSchema,
      required: true,
    },
    senderKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    readBy: {
      type: [chatActorSchema],
      default: [],
    },
    readByKeys: {
      type: [String],
      default: [],
      index: true,
    },
  },
  { timestamps: true }
);

chatMessageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
