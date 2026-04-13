const mongoose = require('mongoose');
const MonthlyTeamTarget = require('../models/monthlyTeamTarget');
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

async function getTeamTargetAmount(managerId, year, month) {
  const doc = await MonthlyTeamTarget.findOne({
    managerId,
    year,
    month,
  }).lean();
  return doc ? doc.targetAmount : null;
}

/**
 * Individual remaining = team target − this user's sum for the month (target missing → null remaining).
 */
async function salesUserMonthSummary(salesUser, year, month) {
  const managerId = salesUser.managerId;
  if (!managerId) {
    return {
      year,
      month,
      teamTargetAmount: null,
      myTotalSales: 0,
      remaining: null,
    };
  }

  const [teamTargetAmount, myTotalSales] = await Promise.all([
    getTeamTargetAmount(managerId, year, month),
    sumDailySalesForUserInMonth(salesUser._id, year, month),
  ]);

  const remaining =
    teamTargetAmount != null
      ? Math.max(0, teamTargetAmount - myTotalSales)
      : null;

  return {
    year,
    month,
    teamTargetAmount,
    myTotalSales,
    remaining,
  };
}

module.exports = {
  monthUtcRange,
  parseSaleDate,
  sumDailySalesForUserInMonth,
  getTeamTargetAmount,
  salesUserMonthSummary,
};
