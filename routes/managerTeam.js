const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/users');
const MonthlySalesUserTarget = require('../models/monthlySalesUserTarget');
const DailySale = require('../models/dailySale');
const { requireManager } = require('../middleware/managerAuth');
const {
  sumDailySalesForUserInMonth,
  getSalesUserMonthlyTargetAmount,
  getSalesUserMonthlyTargetsMap,
  sumDefinedTargets,
  monthUtcRange,
} = require('../utils/salesHelpers');

/** Daily rows + month summary for one rep (manager must own this sales user). */
async function repDailySalesPayload(managerId, salesUserId, year, month) {
  const rep = await User.findOne({
    _id: salesUserId,
    managerId,
    designation: 'sales',
    approvalStatus: 'approved',
  })
    .select('name phone')
    .lean();
  if (!rep) return null;
  const { start, end } = monthUtcRange(year, month);
  const [rows, monthTotal, monthlyTargetAmount, targetDoc] = await Promise.all([
    DailySale.find({
      salesUserId: rep._id,
      saleDate: { $gte: start, $lt: end },
    })
      .sort({ saleDate: -1, createdAt: -1 })
      .lean(),
    sumDailySalesForUserInMonth(rep._id, year, month),
    getSalesUserMonthlyTargetAmount(rep._id, year, month),
    MonthlySalesUserTarget.findOne({
      salesUserId: rep._id,
      year,
      month,
    })
      .select('_id')
      .lean(),
  ]);
  const remaining =
    monthlyTargetAmount != null
      ? Math.max(0, monthlyTargetAmount - monthTotal)
      : null;
  return {
    rep: {
      userId: rep._id,
      name: rep.name,
      phone: rep.phone,
    },
    year,
    month,
    monthTotal,
    teamTargetAmount: monthlyTargetAmount,
    monthlyTargetAmount,
    hasTarget: Boolean(targetDoc),
    remaining,
    dailySales: rows,
  };
}

const router = express.Router();

function parseYearMonthBody(body) {
  const y = parseInt(body?.year, 10);
  const m = parseInt(body?.month, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return null;
  }
  return { year: y, month: m };
}

function parseYearMonthQuery(query) {
  const y = parseInt(query.year, 10);
  const m = parseInt(query.month, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return null;
  }
  return { year: y, month: m };
}

/** Set this rep's monthly target (per-user only). */
router.put('/sales-user-target', requireManager, async (req, res) => {
  const ym = parseYearMonthBody(req.body);
  const { salesUserId, targetAmount } = req.body || {};
  if (!ym) {
    return res.status(400).json({
      error: 'year and month (1-12) are required',
    });
  }
  if (!salesUserId || !mongoose.isValidObjectId(salesUserId)) {
    return res.status(400).json({ error: 'Valid salesUserId is required' });
  }
  const amt = Number(targetAmount);
  if (!Number.isFinite(amt) || amt < 0) {
    return res.status(400).json({
      error: 'targetAmount must be a non-negative number',
    });
  }

  try {
    const rep = await User.findOne({
      _id: salesUserId,
      managerId: req.manager._id,
      designation: 'sales',
      approvalStatus: 'approved',
    }).select('_id');
    if (!rep) {
      return res.status(404).json({
        error: 'Sales rep not found on your team',
      });
    }
    const doc = await MonthlySalesUserTarget.findOneAndUpdate(
      { salesUserId: rep._id, year: ym.year, month: ym.month },
      {
        $set: {
          managerId: req.manager._id,
          salesUserId: rep._id,
          year: ym.year,
          month: ym.month,
          targetAmount: amt,
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
    return res.json({
      salesUserTarget: {
        salesUserId: doc.salesUserId,
        year: doc.year,
        month: doc.month,
        targetAmount: doc.targetAmount,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate sales user target' });
    }
    return res.status(500).json({ error: 'Failed to save sales user target' });
  }
});

/** Remove this rep's monthly target for the month (no goal until set again). */
router.delete('/sales-user-target', requireManager, async (req, res) => {
  const ym = parseYearMonthQuery(req.query);
  const { salesUserId } = req.query || {};
  if (!ym) {
    return res.status(400).json({
      error: 'Query params year and month (1-12) are required',
    });
  }
  if (!salesUserId || !mongoose.isValidObjectId(salesUserId)) {
    return res.status(400).json({ error: 'Valid salesUserId is required' });
  }
  try {
    const rep = await User.findOne({
      _id: salesUserId,
      managerId: req.manager._id,
      designation: 'sales',
      approvalStatus: 'approved',
    }).select('_id');
    if (!rep) {
      return res.status(404).json({ error: 'Sales rep not found on your team' });
    }
    await MonthlySalesUserTarget.deleteOne({
      salesUserId: rep._id,
      year: ym.year,
      month: ym.month,
    });
    return res.json({ message: 'Sales user target cleared' });
  } catch {
    return res.status(500).json({ error: 'Failed to clear sales user target' });
  }
});

router.get('/team-summary', requireManager, async (req, res) => {
  const ym = parseYearMonthQuery(req.query);
  if (!ym) {
    return res.status(400).json({
      error: 'Query params year and month (1-12) are required',
    });
  }

  try {
    const salesUsers = await User.find({
      managerId: req.manager._id,
      designation: 'sales',
      approvalStatus: 'approved',
    })
      .select('name phone')
      .lean();

    const ids = salesUsers.map((u) => u._id);
    const [targetMap, targetDocs] = await Promise.all([
      getSalesUserMonthlyTargetsMap(ym.year, ym.month, ids),
      MonthlySalesUserTarget.find({
        salesUserId: { $in: ids },
        year: ym.year,
        month: ym.month,
      })
        .select('salesUserId')
        .lean(),
    ]);
    const hasTargetSet = new Set(targetDocs.map((d) => String(d.salesUserId)));

    const members = await Promise.all(
      salesUsers.map(async (u) => {
        const myTotalSales = await sumDailySalesForUserInMonth(
          u._id,
          ym.year,
          ym.month
        );
        const targetAmount = targetMap.get(String(u._id)) ?? null;
        const remaining =
          targetAmount != null
            ? Math.max(0, targetAmount - myTotalSales)
            : null;
        return {
          userId: u._id,
          name: u.name,
          phone: u.phone,
          myTotalSales,
          targetAmount,
          hasTarget: hasTargetSet.has(String(u._id)),
          remaining,
        };
      })
    );

    const teamTargetAmount = sumDefinedTargets(targetMap);

    return res.json({
      year: ym.year,
      month: ym.month,
      teamTargetAmount,
      members,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load team summary' });
  }
});

/** One rep’s daily log for a month (manager must manage this sales user). */
router.get('/rep/:salesUserId/daily-sales', requireManager, async (req, res) => {
  const ym = parseYearMonthQuery(req.query);
  if (!ym) {
    return res.status(400).json({
      error: 'Query params year and month (1-12) are required',
    });
  }
  const { salesUserId } = req.params;
  if (!mongoose.isValidObjectId(salesUserId)) {
    return res.status(400).json({ error: 'Invalid sales user id' });
  }
  try {
    const payload = await repDailySalesPayload(
      req.manager._id,
      salesUserId,
      ym.year,
      ym.month
    );
    if (!payload) {
      return res.status(404).json({ error: 'Sales rep not found on your team' });
    }
    return res.json(payload);
  } catch {
    return res.status(500).json({ error: 'Failed to load rep daily sales' });
  }
});

/** All daily sale rows for approved sales reps under this manager in the month */
router.get('/team-daily-sales', requireManager, async (req, res) => {
  const ym = parseYearMonthQuery(req.query);
  if (!ym) {
    return res.status(400).json({
      error: 'Query params year and month (1-12) are required',
    });
  }
  try {
    const { start, end } = monthUtcRange(ym.year, ym.month);
    const salesUsers = await User.find({
      managerId: req.manager._id,
      designation: 'sales',
      approvalStatus: 'approved',
    })
      .select('_id name phone')
      .lean();
    const ids = salesUsers.map((u) => u._id);
    const meta = Object.fromEntries(
      salesUsers.map((u) => [String(u._id), { name: u.name, phone: u.phone }])
    );
    const rows = await DailySale.find({
      salesUserId: { $in: ids },
      saleDate: { $gte: start, $lt: end },
    })
      .sort({ saleDate: -1, createdAt: -1 })
      .lean();
    const dailySales = rows.map((r) => {
      const m = meta[String(r.salesUserId)];
      return {
        ...r,
        repName: m?.name ?? '—',
        repPhone: m?.phone ?? '—',
      };
    });
    return res.json({
      year: ym.year,
      month: ym.month,
      dailySales,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load team daily sales' });
  }
});

module.exports = router;
