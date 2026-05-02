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

/** Common lookup path for user/month daily-log lists; multiple logs per day are allowed. */
dailySaleSchema.index({ salesUserId: 1, saleDate: -1 });

/** Managers still keep one own daily log per calendar date. */
dailySaleSchema.index(
  { salesUserId: 1, saleDate: 1, entryKind: 1 },
  {
    unique: true,
    partialFilterExpression: { entryKind: 'manager' },
    name: 'manager_daily_sale_unique',
  }
);

module.exports = mongoose.model('DailySale', dailySaleSchema);
