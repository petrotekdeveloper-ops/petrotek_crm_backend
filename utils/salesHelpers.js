const mongoose = require('mongoose');
const MonthlySalesUserTarget = require('../models/monthlySalesUserTarget');
const DailySale = require('../models/dailySale');

/** UTC bounds for calendar month (inclusive start, exclusive end for queries use $lt nextMonthStart) */
function monthUtcRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

/**
 * Parse YYYY-MM-DD or ISO date; returns UTC midnight for that calendar day or null.
 */
function parseSaleDate(input) {
  if (input == null) return null;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    const [y, m, d] = input.trim().split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
  );
}

async function sumDailySalesForUserInMonth(salesUserId, year, month) {
  const { start, end } = monthUtcRange(year, month);
  const agg = await DailySale.aggregate([
    {
      $match: {
        salesUserId: new mongoose.Types.ObjectId(salesUserId),
        saleDate: { $gte: start, $lt: end },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return agg.length ? agg[0].total : 0;
}

/** Monthly target for one sales user (only source: MonthlySalesUserTarget). */
async function getSalesUserMonthlyTargetAmount(salesUserId, year, month) {
  const doc = await MonthlySalesUserTarget.findOne({
    salesUserId,
    year,
    month,
  }).lean();
  return doc ? doc.targetAmount : null;
}

/**
 * Batch-resolve targets for many reps (avoids N+1 queries).
 * Returns Map: salesUserId string → target (number | null if no row).
 */
async function getSalesUserMonthlyTargetsMap(year, month, salesUserIds) {
  if (!salesUserIds.length) {
    return new Map();
  }
  const oidList = salesUserIds.map((id) =>
    id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)
  );
  const docs = await MonthlySalesUserTarget.find({
    salesUserId: { $in: oidList },
    year,
    month,
  }).lean();
  const byUser = new Map(
    docs.map((d) => [String(d.salesUserId), d.targetAmount])
  );
  const map = new Map();
  for (const id of salesUserIds) {
    const key = String(id);
    map.set(key, byUser.has(key) ? byUser.get(key) : null);
  }
  return map;
}

function sumDefinedTargets(map) {
  let sum = 0;
  let any = false;
  for (const v of map.values()) {
    if (v != null && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

/**
 * Remaining = monthly target − this user's sum (no target row → null remaining).
 */
async function salesUserMonthSummary(salesUser, year, month) {
  const managerId = salesUser.managerId;
  if (!managerId) {
    return {
      year,
      month,
      teamTargetAmount: null,
      monthlyTargetAmount: null,
      myTotalSales: 0,
      remaining: null,
    };
  }

  const [monthlyTargetAmount, myTotalSales] = await Promise.all([
    getSalesUserMonthlyTargetAmount(salesUser._id, year, month),
    sumDailySalesForUserInMonth(salesUser._id, year, month),
  ]);

  const remaining =
    monthlyTargetAmount != null
      ? Math.max(0, monthlyTargetAmount - myTotalSales)
      : null;

  return {
    year,
    month,
    teamTargetAmount: monthlyTargetAmount,
    monthlyTargetAmount,
    myTotalSales,
    remaining,
  };
}

module.exports = {
  monthUtcRange,
  parseSaleDate,
  sumDailySalesForUserInMonth,
  getSalesUserMonthlyTargetAmount,
  getSalesUserMonthlyTargetsMap,
  sumDefinedTargets,
  salesUserMonthSummary,
};
