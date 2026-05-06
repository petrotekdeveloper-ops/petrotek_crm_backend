const mongoose = require('mongoose');

const chatParticipantSchema = new mongoose.Schema(
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

const chatConversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['direct'],
      default: 'direct',
      required: true,
    },
    participants: {
      type: [chatParticipantSchema],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length === 2;
        },
        message: 'A direct conversation must have exactly two participants',
      },
      required: true,
    },
    participantKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    lastMessageText: {
      type: String,
      default: '',
      trim: true,
    },
    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastMessageSenderKey: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ChatConversation', chatConversationSchema);
