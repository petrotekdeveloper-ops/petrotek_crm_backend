const DailySale = require('../models/dailySale');

function displayField(v) {
  if (v == null) return '—';
  const s = String(v).trim();
  return s === '' ? '—' : s;
}

/**
 * Sum DailySale rows by salesUserId (month or day match), with user lookup.
 * @param {object} match - Mongo filter including saleDate and salesUserId
 * @param {{ limit?: number|null }} options - limit for top-N (e.g. summary); omit for full list
 */
async function aggregateSalesLogsByUser(match, options = {}) {
  const { limit = null } = options;
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
        totalAmount: 1,
        logCount: 1,
      },
    }
  );

  const rows = await DailySale.aggregate(pipeline);
  return rows.map((row) => ({
    salesUserId: row.salesUserId,
    salesUserName: displayField(row.salesUserName),
    salesUserPhone: displayField(row.salesUserPhone),
    salesUserDesignation: displayField(row.salesUserDesignation),
    totalAmount: Number(row.totalAmount || 0),
    logCount: row.logCount || 0,
  }));
}

module.exports = {
  aggregateSalesLogsByUser,
};
