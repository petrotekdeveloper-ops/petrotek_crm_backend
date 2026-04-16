const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tripDate: {
      type: Date,
      required: true,
    },
    pickupLocation: {
      type: String,
      required: true,
      trim: true,
    },
    dropLocation: {
      type: String,
      required: true,
      trim: true,
    },
    distance: {
      type: Number,
      required: true,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

tripSchema.index({ driverId: 1, tripDate: -1, createdAt: -1 });

module.exports = mongoose.model('Trip', tripSchema);
