const DailySale = require('../models/dailySale');
const MonthlySalesUserTarget = require('../models/monthlySalesUserTarget');

function displayField(v) {
  if (v == null) return '—';
  const s = String(v).trim();
  return s === '' ? '—' : s;
}

/**
 * Sum DailySale rows by salesUserId (month or day match), with user lookup.
 * @param {object} match - Mongo filter including saleDate and salesUserId
 * @param {{ limit?: number|null, year?: number, month?: number }} options - limit for top-N (e.g. summary); omit for full list
 */
async function aggregateSalesLogsByUser(match, options = {}) {
  const { limit = null, year = null, month = null } = options;
  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$salesUserId',
        totalAmount: { $sum: '$amount' },
        logCount: { $sum: 1 },
      },
    },
    { $sort: { totalAmount: -1, logCount: -1 } },
  ];
  if (limit != null && Number.isFinite(limit) && limit > 0) {
    pipeline.push({ $limit: limit });
  }
  pipeline.push(
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'salesUser',
      },
    },
    { $unwind: { path: '$salesUser', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        salesUserId: '$_id',
        salesUserName: '$salesUser.name',
        salesUserPhone: '$salesUser.phone',
        salesUserDesignation: '$salesUser.designation',
        managerDefaultTargetAmount: '$salesUser.managerDefaultTargetAmount',
        totalAmount: 1,
        logCount: 1,
      },
    }
  );

  const rows = await DailySale.aggregate(pipeline);
  const targetByUser = new Map();

  if (year != null && month != null && rows.length > 0) {
    const ids = rows.map((row) => row.salesUserId).filter(Boolean);
    const targets = await MonthlySalesUserTarget.find({
      salesUserId: { $in: ids },
      year,
      month,
    })
      .select('salesUserId targetAmount')
      .lean();
    for (const target of targets) {
      targetByUser.set(String(target.salesUserId), Number(target.targetAmount || 0));
    }
  }

  return rows.map((row) => ({
    salesUserId: row.salesUserId,
    salesUserName: displayField(row.salesUserName),
    salesUserPhone: displayField(row.salesUserPhone),
    salesUserDesignation: displayField(row.salesUserDesignation),
    totalAmount: Number(row.totalAmount || 0),
    targetAmount:
      row.salesUserDesignation === 'manager'
        ? row.managerDefaultTargetAmount != null
          ? Number(row.managerDefaultTargetAmount)
          : null
        : targetByUser.has(String(row.salesUserId))
          ? targetByUser.get(String(row.salesUserId))
          : null,
    logCount: row.logCount || 0,
  }));
}

module.exports = {
  aggregateSalesLogsByUser,
};
