const mongoose = require('mongoose');

const kpiTargetSchema = new mongoose.Schema(
  {
    dailyTarget: { type: String, default: '' },
    achievedToday: { type: String, default: '' },
    achievedTillDate: { type: String, default: '' },
    balance: { type: String, default: '' },
    percentage: { type: String, default: '' },
  },
  { _id: false }
);

const customerActivityRowSchema = new mongoose.Schema(
  {
    customerType: { type: String, enum: ['', 'N', 'E'], default: '' },
    customerName: { type: String, default: '' },
    purpose: { type: String, default: '' },
    outcomeNextAction: { type: String, default: '' },
    quoteAed: { type: String, default: '' },
    orderAed: { type: String, default: '' },
  },
  { _id: false }
);

const indoorSupportRowSchema = new mongoose.Schema(
  {
    taskCompleted: { type: String, default: '' },
    customerOrDepartment: { type: String, default: '' },
    resultOutcome: { type: String, default: '' },
    whomSupported: { type: String, default: '' },
    qtyOrValue: { type: String, default: '' },
  },
  { _id: false }
);

const dailyReportsSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    companyName: {
      type: String,
      default: '',
    },
    salesExecutiveName: {
      type: String,
      default: '',
    },
    type: {
      type: String,
      enum: ['indoor', 'outdoor'],
      required: true,
    },
    dailyTargetAchievement: {
      newCustomers: { type: kpiTargetSchema, default: () => ({}) },
      existingFollowUps: { type: kpiTargetSchema, default: () => ({}) },
      customerVisits: { type: kpiTargetSchema, default: () => ({}) },
      callsMade: { type: kpiTargetSchema, default: () => ({}) },
      quotationsSent: { type: kpiTargetSchema, default: () => ({}) },
      ordersReceived: { type: kpiTargetSchema, default: () => ({}) },
      collectionFollowUps: { type: kpiTargetSchema, default: () => ({}) },
    },
    customerActivities: {
      type: [customerActivityRowSchema],
      default: [],
    },
    activityCountSummary: {
      totalActivitiesDoneToday: { type: String, default: '' },
      pendingNonProductive: { type: String, default: '' },
      activitiesNotInCrm: { type: String, default: '' },
      productiveActivities: { type: String, default: '' },
      activitiesUpdatedInCrm: { type: String, default: '' },
      crmUpdated: { type: Boolean, default: false },
    },
    businessGenerated: {
      totalQuotationValue: { type: String, default: '' },
      totalOrderValue: { type: String, default: '' },
      collectionsFollowedUp: { type: String, default: '' },
      pipelineValue: { type: String, default: '' },
    },
    indoorSupportActivities: {
      type: [indoorSupportRowSchema],
      default: [],
    },
    topAchievementsToday: {
      type: [String],
      default: [],
    },
    tomorrowsPlan: {
      type: [String],
      default: [],
    },
    managementCheck: {
      customerNamesRecorded: { type: Boolean, default: false },
      outcomesMentioned: { type: Boolean, default: false },
      quoteValuesRecorded: { type: Boolean, default: false },
      orderValuesRecorded: { type: Boolean, default: false },
      newCustomersClearlyMarked: { type: Boolean, default: false },
      businessGeneratedVisible: { type: Boolean, default: false },
      crmUpdated: { type: Boolean, default: false },
      verifiedByManager: { type: Boolean, default: false },
      managerRemarks: { type: String, default: '' },
      managerInitials: { type: String, default: '' },
      verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      verifiedAt: {
        type: Date,
        default: null,
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DailyReports', dailyReportsSchema);