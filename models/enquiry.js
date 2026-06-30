const mongoose = require('mongoose');

const enquirySchema = new mongoose.Schema(
  {
    dateReceived: {
      type: Date,
      required: true,
    },
    serialNo: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    customerCompany: {
      type: String,
      required: true,
      trim: true,
    },
    contactPerson: {
      type: String,
      trim: true,
      default: '',
    },
    sourceContact: {
      type: String,
      trim: true,
      default: '',
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    leadSource: {
      type: String,
      required: true,
      trim: true,
    },
    leadType: {
      type: String,
      trim: true,
      default: '',
    },
    priority: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      required: true,
      trim: true,
    },
    closedDate: {
      type: Date,
      default: null,
    },
    itemProduct: {
      type: String,
      trim: true,
      default: '',
    },
    qty: {
      type: Number,
      default: null,
    },
    unit: {
      type: String,
      trim: true,
      default: '',
    },
    stockPosition: {
      type: String,
      trim: true,
      default: '',
    },
    avgMonthlyMovement: {
      type: Number,
      default: null,
    },
    offerNo: {
      type: String,
      trim: true,
      default: '',
    },
    offerDate: {
      type: Date,
      default: null,
    },
    offeredValueAed: {
      type: Number,
      default: null,
    },
    orderValueAed: {
      type: Number,
      default: null,
    },
    expectedClosureDate: {
      type: Date,
      default: null,
    },
    nextActionDate: {
      type: Date,
      required: true,
    },
    actionTaken: {
      type: String,
      required: true,
      trim: true,
    },
    reasonLostPending: {
      type: String,
      trim: true,
      default: '',
    },
    converted: {
      type: Boolean,
      default: false,
    },
    managerReview: {
      type: String,
      trim: true,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

enquirySchema.index({ createdBy: 1, dateReceived: -1 });
enquirySchema.index({ status: 1, nextActionDate: 1 });
enquirySchema.index({ customerCompany: 1 });

module.exports = mongoose.model('Enquiry', enquirySchema);
