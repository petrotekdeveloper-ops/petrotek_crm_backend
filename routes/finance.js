const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/users');
const DailySale = require('../models/dailySale');
const {
  parseSaleDate,
  withMissingDailySaleZeros,
  withMissingDailySaleZerosForDates,
  monthUtcRange,
} = require('../utils/salesHelpers');
const { requireFinance } = require('../middleware/financeAuth');

const router = express.Router();

const FINANCE_SALES_LOG_DESIGNATIONS = ['sales', 'manager'];

function displaySalesUserField(v) {
  if (v == null) return '—';
  const s = String(v).trim();
  return s === '' ? '—' : s;
}

function dailySaleVirtualId(salesUserId, saleDate) {
  return `virtual-zero:${salesUserId}:${saleDate.toISOString().slice(0, 10)}`;
}

function makeFinanceZeroSaleRow(user, saleDate) {
  return {
    _id: dailySaleVirtualId(user._id, saleDate),
    salesUserId: user._id,
    saleDate,
    amount: 0,
    note: 'No sales log entered',
    entryKind: 'system-zero',
    isSystemGenerated: true,
    createdAt: null,
    updatedAt: null,
    salesUserName: displaySalesUserField(user.name),
    salesUserPhone: displaySalesUserField(user.phone),
    salesUserDesignation: user.designation || '—',
  };
}

function parseYearMonth(query) {
  const y = parseInt(query?.year, 10);
  const m = parseInt(query?.month, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return null;
  }
  return { year: y, month: m };
}

/** Single day (date=) or whole calendar month (year=&month=). */
function resolveFinanceSalesLogsFilter(query) {
  const ym = parseYearMonth(query);
  if (ym) {
    const { start, end } = monthUtcRange(ym.year, ym.month);
    return {
      filter: { saleDate: { $gte: start, $lt: end } },
      summaryMeta: { year: ym.year, month: ym.month },
      isMonthRange: true,
    };
  }
  const saleDate = parseSaleDate(query?.date);
  if (saleDate) {
    return {
      filter: { saleDate },
      summaryMeta: { date: saleDate },
      isMonthRange: false,
    };
  }
  return null;
}

async function financeEligibleUserIds(salesUserId) {
  const q = {
    designation: { $in: FINANCE_SALES_LOG_DESIGNATIONS },
    approvalStatus: 'approved',
  };
  if (salesUserId) {
    q._id = salesUserId;
  }
  const users = await User.find(q).select('_id').lean();
  return users.map((u) => u._id);
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const u =
    process.env.finance_username ?? process.env.FINANCE_USERNAME;
  const p =
    process.env.finance_password ?? process.env.FINANCE_PASSWORD;
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({ error: 'Server configuration error' });
  }
  if (!u || !p) {
    return res.status(500).json({ error: 'Server configuration error' });
  }
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (username !== u || password !== p) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { role: 'finance', sub: 'finance' },
    secret,
    { expiresIn: '7d' }
  );
  res.json({ token });
});

router.get('/me', requireFinance, (req, res) => {
  res.json({ role: req.finance.role, sub: req.finance.sub });
});

router.get('/sales-logs/summary', requireFinance, async (req, res) => {
  const { salesUserId } = req.query;
  const resolved = resolveFinanceSalesLogsFilter(req.query);
  if (!resolved) {
    return res.status(400).json({
      error: 'Provide date=YYYY-MM-DD for a single day, or year=YYYY&month=MM (1–12) for a month',
    });
  }
  if (salesUserId && !mongoose.isValidObjectId(salesUserId)) {
    return res.status(400).json({ error: 'Invalid salesUserId' });
  }

  const oid =
    salesUserId && mongoose.isValidObjectId(salesUserId)
      ? new mongoose.Types.ObjectId(salesUserId)
      : null;
  let allowedIds;
  try {
    allowedIds = await financeEligibleUserIds(oid);
  } catch {
    return res.status(500).json({ error: 'Failed to resolve users' });
  }
  if (salesUserId && allowedIds.length === 0) {
    return res.status(404).json({ error: 'User not found or not a sales/manager rep' });
  }
  if (allowedIds.length === 0) {
    return res.json({
      summary: {
        ...resolved.summaryMeta,
        totalLogs: 0,
        totalAmount: 0,
        avgAmount: 0,
        activeSalesUsers: 0,
        topSalesUsers: [],
      },
    });
  }

  const match = {
    ...resolved.filter,
    salesUserId: { $in: allowedIds },
  };

  try {
    const [totals, bySalesUser] = await Promise.all([
      DailySale.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalLogs: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
            avgAmount: { $avg: '$amount' },
            activeSalesUsers: { $addToSet: '$salesUserId' },
          },
        },
        {
          $project: {
            _id: 0,
            totalLogs: 1,
            totalAmount: 1,
            avgAmount: 1,
            activeSalesUsers: { $size: '$activeSalesUsers' },
          },
        },
      ]),
      DailySale.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$salesUserId',
            totalAmount: { $sum: '$amount' },
            logCount: { $sum: 1 },
          },
        },
        { $sort: { totalAmount: -1, logCount: -1 } },
        { $limit: 10 },
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
        },
      ]),
    ]);

    const t = totals[0] || {
      totalLogs: 0,
      totalAmount: 0,
      avgAmount: 0,
      activeSalesUsers: 0,
    };

    return res.json({
      summary: {
        ...resolved.summaryMeta,
        totalLogs: t.totalLogs || 0,
        totalAmount: Number(t.totalAmount || 0),
        avgAmount: Number(t.avgAmount || 0),
        activeSalesUsers: t.activeSalesUsers || 0,
        topSalesUsers: bySalesUser,
      },
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load sales log summary' });
  }
});

router.get('/sales-logs', requireFinance, async (req, res) => {
  const { salesUserId } = req.query;
  const resolved = resolveFinanceSalesLogsFilter(req.query);
  if (!resolved) {
    return res.status(400).json({
      error: 'Provide date=YYYY-MM-DD for a single day, or year=YYYY&month=MM (1–12) for a month',
    });
  }
  if (salesUserId && !mongoose.isValidObjectId(salesUserId)) {
    return res.status(400).json({ error: 'Invalid salesUserId' });
  }

  const limitRaw = Number(req.query?.limit);
  const maxLimit = resolved.isMonthRange ? 5000 : 500;
  const defaultLimit = resolved.isMonthRange ? 2000 : 250;
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(maxLimit, Math.trunc(limitRaw)))
    : defaultLimit;

  const oid =
    salesUserId && mongoose.isValidObjectId(salesUserId)
      ? new mongoose.Types.ObjectId(salesUserId)
      : null;

  let allowedIds;
  try {
    allowedIds = await financeEligibleUserIds(oid);
  } catch {
    return res.status(500).json({ error: 'Failed to resolve users' });
  }
  if (salesUserId && allowedIds.length === 0) {
    return res.status(404).json({ error: 'User not found or not a sales/manager rep' });
  }

  const filter = {
    ...resolved.filter,
    salesUserId: { $in: allowedIds },
  };
  if (salesUserId) {
    filter.salesUserId = salesUserId;
  }

  const logUsersFilter = {
    designation: { $in: FINANCE_SALES_LOG_DESIGNATIONS },
    approvalStatus: 'approved',
  };
  if (salesUserId) {
    logUsersFilter._id = salesUserId;
  }

  try {
    const [logs, logUsers] = await Promise.all([
      DailySale.find(filter)
        .sort({ saleDate: -1, createdAt: -1 })
        .populate('salesUserId', 'name phone managerId approvalStatus designation')
        .lean(),
      User.find(logUsersFilter).select('_id name phone designation').lean(),
    ]);

    const rows = logs.map((row) => {
      const ref = row.salesUserId;
      const populatedUser =
        ref &&
        typeof ref === 'object' &&
        !(ref instanceof mongoose.Types.ObjectId) &&
        Object.prototype.hasOwnProperty.call(ref, 'name')
          ? ref
          : null;
      return {
        ...row,
        salesUserId: populatedUser?._id ?? row.salesUserId,
        salesUserName: displaySalesUserField(populatedUser?.name),
        salesUserPhone: displaySalesUserField(populatedUser?.phone),
        salesUserDesignation: displaySalesUserField(populatedUser?.designation),
      };
    });

    const dailySales = resolved.isMonthRange
      ? withMissingDailySaleZeros(
          rows,
          logUsers,
          resolved.summaryMeta.year,
          resolved.summaryMeta.month,
          makeFinanceZeroSaleRow
        )
      : withMissingDailySaleZerosForDates(
          rows,
          logUsers,
          [resolved.summaryMeta.date],
          makeFinanceZeroSaleRow
        );

    return res.json({
      dailySales: dailySales.slice(0, limit),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to list daily sales logs' });
  }
});

router.get('/sales-users', requireFinance, async (req, res) => {
  try {
    const users = await User.find({
      designation: { $in: FINANCE_SALES_LOG_DESIGNATIONS },
      approvalStatus: 'approved',
    })
      .select('_id name phone designation managerId company')
      .sort({ designation: 1, name: 1 })
      .lean();
    return res.json({ users });
  } catch {
    return res.status(500).json({ error: 'Failed to list sales and manager users' });
  }
});

module.exports = router;
