const mongoose = require('mongoose');

const serviceLogSchema = new mongoose.Schema(
  {
    serviceUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    customer: {
      type: String,
      required: true,
      trim: true,
    },
    service: {
      type: String,
      required: true,
      trim: true,
    },
    km: {
      type: Number,
      required: true,
      min: 0,
    },
    spares: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

serviceLogSchema.index({ serviceUserId: 1, date: -1, createdAt: -1 });

module.exports = mongoose.model('ServiceLog', serviceLogSchema);
