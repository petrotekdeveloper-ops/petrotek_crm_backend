const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    dob: {
      type: Date,
    },
    designation: {
      type: String,
      enum: ['manager', 'sales', 'driver'],
      required: true,
    },
    vehicleNumber: {
      type: String,
      trim: true,
      required: function requiredForDriver() {
        return this.designation === 'driver';
      },
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    /** Sales report to this manager; drivers do not use a manager (admin approval only). */
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
