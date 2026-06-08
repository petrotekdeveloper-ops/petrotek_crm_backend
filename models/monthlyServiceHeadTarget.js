const mongoose = require('mongoose');

/** @deprecated Legacy per-month targets — use `serviceHeadTarget` (one default per service head). */
const monthlyServiceHeadTargetSchema = new mongoose.Schema(
  {
    serviceHeadUserId: {
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
    /** Manager who last set or updated this target (audit only). */
    setByManagerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

monthlyServiceHeadTargetSchema.index(
  { serviceHeadUserId: 1, year: 1, month: 1 },
  { unique: true }
);
monthlyServiceHeadTargetSchema.index({ year: 1, month: 1 });

module.exports = mongoose.model('MonthlyServiceHeadTarget', monthlyServiceHeadTargetSchema);
