const mongoose = require('mongoose');

const quotationSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },
    salesUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    quoteNo: {
      type: String,
      required: true,
    },
    ref: {
      type: String,
      required: true,
    },
    trn: {
      type: String,
      required: true,
    },
    customerDetails: [
      {
        name: {
          type: String,
          required: true,
        },
        trn: {
          type: String,
        },
        phone: {
          type: String,
        },
        mobile: {
          type: String,
        },
        email: {
          type: String,
        },
        address: {
          type: String,
        },
      },
    ],
    quotationItems: [
      {
        itemCode: {
          type: String,
          required: true,
        },
        item: {
          type: String,
          required: true,
        },
        itemQuantity: {
          type: String,
          required: true,
        },
        itemUnitPrice: {
          type: String,
          required: true,
        },
        itemTotalPrice: {
          type: String,
          required: true,
        },
      },
    ],
    subTotal: {
      type: String,
      required: true,
    },
    total: {
      type: String,
      required: true,
    },
    totalWords: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

quotationSchema.index({ salesUserId: 1, date: -1 });

module.exports = mongoose.model('Quotation', quotationSchema);
