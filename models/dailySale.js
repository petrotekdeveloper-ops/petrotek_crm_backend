const mongoose = require('mongoose');

const dailySaleSchema = new mongoose.Schema(
  {
    salesUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    /** Calendar day stored as UTC midnight for that date */
    saleDate: {
      type: Date,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
    entryKind: {
      type: String,
      enum: ['sales', 'manager'],
      default: 'sales',
    },
  },
  { timestamps: true }
);

/** One log per sales user (or manager on own logs) per calendar day (saleDate is UTC midnight). */
dailySaleSchema.index({ salesUserId: 1, saleDate: 1 }, { unique: true });

module.exports = mongoose.model('DailySale', dailySaleSchema);
