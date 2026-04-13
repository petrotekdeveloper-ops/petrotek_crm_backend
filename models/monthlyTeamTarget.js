const mongoose = require('mongoose');

const monthlyTeamTargetSchema = new mongoose.Schema(
  {
    managerId: {
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

monthlyTeamTargetSchema.index(
  { managerId: 1, year: 1, month: 1 },
  { unique: true }
);

module.exports = mongoose.model('MonthlyTeamTarget', monthlyTeamTargetSchema);
