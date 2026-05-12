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
      trim: true,
      default: '',
    },
    service: {
      type: String,
      trim: true,
      default: '',
    },
    km: {
      type: Number,
      min: 0,
      default: 0,
    },
    spares: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      trim: true,
      default: '',
    },
    /** Full visit vs service-head-only amount row (routes enforce who can create which). */
    entryKind: {
      type: String,
      enum: ['full', 'amount_only'],
      default: 'full',
    },
    /** Optional monetary amount; service heads may attach to full logs or amount-only rows. */
    amount: {
      type: Number,
      min: 0,
    },
    /** Short context for amount-only entries (service heads). Ignored on full visit logs by routes. */
    amountNote: {
      type: String,
      trim: true,
      default: '',
      maxLength: 2000,
    },
  },
  { timestamps: true }
);

serviceLogSchema.index({ serviceUserId: 1, date: -1, createdAt: -1 });

module.exports = mongoose.model('ServiceLog', serviceLogSchema);
