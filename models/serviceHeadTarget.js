const mongoose = require('mongoose');

/** Default monthly amount target for a service head — same value applies to every month. */
const serviceHeadTargetSchema = new mongoose.Schema(
  {
    serviceHeadUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    targetAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Manager who last set or updated this target (audit only). */
    setByManagerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ServiceHeadTarget', serviceHeadTargetSchema);
