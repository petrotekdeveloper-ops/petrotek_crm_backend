const mongoose = require('mongoose');

const COMPANY_VALUES = ['Petrotek', 'Seltec'];

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
      enum: ['manager', 'sales', 'driver', 'service'],
      required: true,
    },
    company: {
      type: String,
      enum: COMPANY_VALUES,
      trim: true,
      default: undefined,
      validate: {
        validator(value) {
          // During update validators, `this` can be a query object without designation.
          // In that case, defer role checks to route-level validation/update logic.
          if (!this || this.designation == null) return true;
          const appliesToRole =
            this.designation === 'manager' || this.designation === 'sales';
          if (!appliesToRole) return value == null;
          return COMPANY_VALUES.includes(value);
        },
        message:
          'company is only applicable to manager/sales and must be Petrotek or Seltec',
      },
    },
    vehicleNumber: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    /** Sales report to this manager; driver/service do not use a manager (admin approval only). */
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

// Mongoose 9+: callback `next()` is not passed to all document hooks — use async middleware.
userSchema.pre('validate', async function applyCompanyRules() {
  const appliesToRole =
    this.designation === 'manager' || this.designation === 'sales';
  if (appliesToRole) {
    if (this.company == null || String(this.company).trim() === '') {
      this.company = 'Petrotek';
    }
  } else {
    this.company = undefined;
  }
});

module.exports = mongoose.model('User', userSchema);
