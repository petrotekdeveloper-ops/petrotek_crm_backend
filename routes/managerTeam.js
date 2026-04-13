const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/users');
const MonthlyTeamTarget = require('../models/monthlyTeamTarget');
const DailySale = require('../models/dailySale');
const { requireManager } = require('../middleware/managerAuth');
const {
  sumDailySalesForUserInMonth,
  getTeamTargetAmount,
  monthUtcRange,
} = require('../utils/salesHelpers');

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

router.put('/team-target', requireManager, async (req, res) => {
  const ym = parseYearMonthBody(req.body);
  const { targetAmount } = req.body || {};
  if (!ym) {
    return res.status(400).json({
      error: 'year and month (1-12) are required',
    });
  }
  const amt = Number(targetAmount);
  if (!Number.isFinite(amt) || amt < 0) {
    return res.status(400).json({
      error: 'targetAmount must be a non-negative number',
    });
  }

  try {
    const doc = await MonthlyTeamTarget.findOneAndUpdate(
      { managerId: req.manager._id, year: ym.year, month: ym.month },
      {
        $set: {
          managerId: req.manager._id,
          year: ym.year,
          month: ym.month,
          targetAmount: amt,
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
    return res.json({
      teamTarget: {
        managerId: doc.managerId,
        year: doc.year,
        month: doc.month,
        targetAmount: doc.targetAmount,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate team target' });
    }
    return res.status(500).json({ error: 'Failed to save team target' });
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
    const teamTargetAmount = await getTeamTargetAmount(
      req.manager._id,
      ym.year,
      ym.month
    );

    const salesUsers = await User.find({
      managerId: req.manager._id,
      designation: 'sales',
      approvalStatus: 'approved',
    })
      .select('name phone')
      .lean();

    const members = await Promise.all(
      salesUsers.map(async (u) => {
        const myTotalSales = await sumDailySalesForUserInMonth(
          u._id,
          ym.year,
          ym.month
        );
        const remaining =
          teamTargetAmount != null
            ? Math.max(0, teamTargetAmount - myTotalSales)
            : null;
        return {
          userId: u._id,
          name: u.name,
          phone: u.phone,
          myTotalSales,
          remaining,
        };
      })
    );

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

router.get('/team-target', requireManager, async (req, res) => {
  const ym = parseYearMonthQuery(req.query);
  if (!ym) {
    return res.status(400).json({
      error: 'Query params year and month (1-12) are required',
    });
  }
  try {
    const doc = await MonthlyTeamTarget.findOne({
      managerId: req.manager._id,
      year: ym.year,
      month: ym.month,
    }).lean();
    return res.json({
      teamTarget: doc
        ? {
            year: doc.year,
            month: doc.month,
            targetAmount: doc.targetAmount,
          }
        : null,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load team target' });
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
