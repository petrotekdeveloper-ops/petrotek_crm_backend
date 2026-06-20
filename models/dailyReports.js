const mongoose = require('mongoose');

const dailyReportsSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    type: {
        type: String,
        enum: ['indoor', 'outdoor'],
        required: true,
    },
    attendacne: [
        {
            officeIn: {
                type: String,
                required: true,
            },
            officeOut: {
                type: String,
                required: true,
            },
            odoStart: {
                type: String,
                required: true,
            },
            odoEnd: {
                type: String,
                required: true,
            },
            covered: {
                type: String,
                required: true,
            },
            vehicleNumber: {
                type: String,
                required: true,
            },
        },
    ],
    activity: [
        {
            newVisit: {
                type: String,
                required: true,
            },
            repeatVisit: {
                type: String,
                required: true,
            },
            customerCalls: {
                type: String,
                required: true,
            },
            quotationSend: {
                type: String,
                required: true,
            },
            quotationReceived: {
                type: String,
                required: true,
            },
            paymentFollowUp: {
                type: String,
                required: true,
            },
            newCustomer: {
                type: String,
                required: true,
            },
        },
    ],
    generatedBusiness: [
        {
            quotationValue: {
                type: String,
                required: true,
            },
            orderValue: {
                type: String,
                required: true,
            },
            expectedBusiness: {
                type: String,
                required: true,
            },
            collectionRecived: {
                type: String,
                required: true,
            },
            pipeline: {
                type: String,
                required: true
            },
        },
    ],
    customerVisit:[
        {
            customerName: {
                type: String,
                required: true,
            },
            purpouse: {
                type: String,
                required: true,
            },
            outcome: {
                type: String,
                required: true,
            }
        }
    ],
    notes: {
        type: String,
        required: true,
    },
    managementReview: {
        outdoorVisitVerified: {
            type: Boolean,
            default: false,
        },
        attendanceVerified: {
            type: Boolean,
            default: false,
        },
        reportSubmitted: {
            type: Boolean,
            default: false,
        },
        crmUpdated: {
            type: Boolean,
            default: false,
        },
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
}, { timestamps: true });

module.exports = mongoose.model('DailyReports', dailyReportsSchema);