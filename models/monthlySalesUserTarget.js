const mongoose = require('mongoose');

const monthlySalesUserTargetSchema = new mongoose.Schema(
  {
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    salesUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    targetAmount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true }
);

monthlySalesUserTargetSchema.index(
  { salesUserId: 1, year: 1, month: 1 },
  { unique: true }
);
monthlySalesUserTargetSchema.index({ managerId: 1, year: 1, month: 1 });

module.exports = mongoose.model('MonthlySalesUserTarget', monthlySalesUserTargetSchema);
