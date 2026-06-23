const express = require('express');
const mongoose = require('mongoose');
const DailyReports = require('../models/dailyReports');
const { requireSales } = require('../middleware/salesAuth');
const { requireManager } = require('../middleware/managerAuth');
const { requireAdmin } = require('../middleware/adminAuth');
const User = require('../models/users');

const router = express.Router();

function parseUtcMidnightDate(input) {
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

function parseYearMonth(query) {
  const y = parseInt(query?.year, 10);
  const m = parseInt(query?.month, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return null;
  }
  return { year: y, month: m };
}

function monthUtcRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

const DAILY_REPORT_KPI_KEYS = [
  'newCustomers',
  'existingFollowUps',
  'customerVisits',
  'callsMade',
  'quotationsSent',
  'ordersReceived',
  'collectionFollowUps',
];

function sanitizeSalesDailyTargetRow(row) {
  return {
    achievedToday: row?.achievedToday ?? '',
    remarks: row?.remarks ?? '',
  };
}

function sanitizeSalesDailyTargetAchievement(dta) {
  const out = {};
  for (const key of DAILY_REPORT_KPI_KEYS) {
    out[key] = sanitizeSalesDailyTargetRow(dta?.[key]);
  }
  return out;
}

function resolveSupportActivities(body) {
  if (body?.supportActivities !== undefined) return body.supportActivities;
  if (body?.indoorSupportActivities !== undefined) return body.indoorSupportActivities;
  return undefined;
}

function mergeSalesDailyTargetAchievement(existing, incoming) {
  const sanitized = sanitizeSalesDailyTargetAchievement(incoming);
  const out = {};
  for (const key of DAILY_REPORT_KPI_KEYS) {
    const prev = existing?.[key] || {};
    out[key] = {
      ...sanitized[key],
      managerComments: prev.managerComments ?? '',
    };
  }
  return out;
}

function buildCreatePayload(body) {
  const saleDate = parseUtcMidnightDate(body?.date);
  if (!saleDate) {
    return { error: 'date is required and must be a valid date', payload: null };
  }
  if (!['indoor', 'outdoor'].includes(body?.type)) {
    return { error: "type must be one of: 'indoor', 'outdoor'", payload: null };
  }
  return {
    error: null,
    payload: {
      date: saleDate,
      type: body.type,
      companyName: body.companyName,
      salesExecutiveName: body.salesExecutiveName,
      dailyTargetAchievement: sanitizeSalesDailyTargetAchievement(body.dailyTargetAchievement),
      customerActivities: body.customerActivities,
      activityCountSummary: body.activityCountSummary,
      businessGenerated: body.businessGenerated,
      indoorSupportActivities: resolveSupportActivities(body),
      topAchievementsToday: body.topAchievementsToday,
      tomorrowsPlan: body.tomorrowsPlan,
      managementCheck: body.managementCheck,
    },
  };
}

function buildUpdatePayload(body) {
  const update = {};
  if (body?.date !== undefined) {
    const saleDate = parseUtcMidnightDate(body.date);
    if (!saleDate) {
      return { error: 'date must be a valid date', update: null };
    }
    update.date = saleDate;
  }
  if (body?.type !== undefined) {
    if (!['indoor', 'outdoor'].includes(body.type)) {
      return { error: "type must be one of: 'indoor', 'outdoor'", update: null };
    }
    update.type = body.type;
  }
  if (body?.companyName !== undefined) update.companyName = body.companyName;
  if (body?.salesExecutiveName !== undefined) update.salesExecutiveName = body.salesExecutiveName;
  if (body?.dailyTargetAchievement !== undefined) {
    update.dailyTargetAchievement = body.dailyTargetAchievement;
  }
  if (body?.customerActivities !== undefined) update.customerActivities = body.customerActivities;
  if (body?.activityCountSummary !== undefined) {
    update.activityCountSummary = body.activityCountSummary;
  }
  if (body?.businessGenerated !== undefined) update.businessGenerated = body.businessGenerated;
  const supportActivities = resolveSupportActivities(body);
  if (supportActivities !== undefined) {
    update.indoorSupportActivities = supportActivities;
  }
  if (body?.topAchievementsToday !== undefined) update.topAchievementsToday = body.topAchievementsToday;
  if (body?.tomorrowsPlan !== undefined) update.tomorrowsPlan = body.tomorrowsPlan;
  if (body?.managementCheck !== undefined) update.managementCheck = body.managementCheck;
  if (Object.keys(update).length === 0) {
    return { error: 'At least one updatable field is required', update: null };
  }
  return { error: null, update };
}

function mapValidationError(err) {
  if (!err || err.name !== 'ValidationError') return null;
  const first = Object.values(err.errors || {})[0];
  return first?.message || 'Validation failed';
}

function buildManagerVerificationUpdate(body) {
  const fields = [
    'customerNamesRecorded',
    'outcomesMentioned',
    'quoteValuesRecorded',
    'orderValuesRecorded',
    'newCustomersClearlyMarked',
    'businessGeneratedVisible',
    'crmUpdated',
    'verifiedByManager',
  ];
  const kpiKeys = DAILY_REPORT_KPI_KEYS;
  const update = {};

  for (const field of fields) {
    if (body?.[field] === undefined) continue;
    if (typeof body[field] !== 'boolean') {
      return { error: `${field} must be boolean`, update: null };
    }
    update[`managementCheck.${field}`] = body[field];
  }

  if (body?.managerRemarks !== undefined) {
    update['managementCheck.managerRemarks'] = body.managerRemarks;
  }
  if (body?.managerInitials !== undefined) {
    update['managementCheck.managerInitials'] = body.managerInitials;
  }

  const dta = body?.dailyTargetAchievement;
  if (dta && typeof dta === 'object') {
    for (const key of kpiKeys) {
      const row = dta[key];
      if (row?.managerComments !== undefined) {
        update[`dailyTargetAchievement.${key}.managerComments`] = String(row.managerComments ?? '');
      }
    }
  }

  if (Object.keys(update).length === 0) {
    return {
      error:
        'At least one management check field is required',
      update: null,
    };
  }

  return { error: null, update };
}

async function managerTeamSalesUsers(managerId) {
  const users = await User.find({
    managerId,
    designation: 'sales',
    approvalStatus: 'approved',
  })
    .select('_id name phone')
    .lean();
  return users;
}

router.get('/', requireSales, async (req, res) => {
  const filter = { user: req.salesUser._id };

  if (req.query?.type) {
    if (!['indoor', 'outdoor'].includes(req.query.type)) {
      return res.status(400).json({ error: "type must be one of: 'indoor', 'outdoor'" });
    }
    filter.type = req.query.type;
  }

  if (req.query?.date) {
    const saleDate = parseUtcMidnightDate(req.query.date);
    if (!saleDate) {
      return res.status(400).json({ error: 'Invalid date query' });
    }
    filter.date = saleDate;
  }

  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(200, Math.trunc(limitRaw)))
    : 100;

  try {
    const reports = await DailyReports.find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(limit)
      .lean();
    return res.json({ reports });
  } catch {
    return res.status(500).json({ error: 'Failed to list daily reports' });
  }
});

router.post('/', requireSales, async (req, res) => {
  const { error, payload } = buildCreatePayload(req.body || {});
  if (error) {
    return res.status(400).json({ error });
  }
  try {
    const doc = await DailyReports.create({
      ...payload,
      user: req.salesUser._id,
    });
    return res.status(201).json({ report: doc });
  } catch (err) {
    const validationError = mapValidationError(err);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    return res.status(500).json({ error: 'Failed to create daily report' });
  }
});

router.get('/manager/team', requireManager, async (req, res) => {
  if (req.query?.type && !['indoor', 'outdoor'].includes(req.query.type)) {
    return res.status(400).json({ error: "type must be one of: 'indoor', 'outdoor'" });
  }
  if (req.query?.salesUserId && !mongoose.isValidObjectId(req.query.salesUserId)) {
    return res.status(400).json({ error: 'Invalid salesUserId query' });
  }

  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(500, Math.trunc(limitRaw)))
    : 200;

  try {
    const salesUsers = await managerTeamSalesUsers(req.manager._id);
    const teamIds = salesUsers.map((u) => u._id);
    const teamIdSet = new Set(teamIds.map((id) => String(id)));
    if (teamIds.length === 0) {
      return res.json({ reports: [] });
    }

    const userFilter = teamIds;
    if (req.query?.salesUserId != null) {
      if (!teamIdSet.has(String(req.query.salesUserId))) {
        return res.status(404).json({ error: 'Sales user not found on your team' });
      }
      userFilter.splice(0, userFilter.length, req.query.salesUserId);
    }

    const filter = {
      user: { $in: userFilter },
    };

    if (req.query?.type) {
      filter.type = req.query.type;
    }
    const ym = parseYearMonth(req.query);
    if (ym) {
      const { start, end } = monthUtcRange(ym.year, ym.month);
      filter.date = { $gte: start, $lt: end };
    } else if (req.query?.date) {
      const date = parseUtcMidnightDate(req.query.date);
      if (!date) return res.status(400).json({ error: 'Invalid date query' });
      filter.date = date;
    }

    const reports = await DailyReports.find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(limit)
      .populate('user', 'name phone company')
      .lean();
    return res.json({ reports });
  } catch {
    return res.status(500).json({ error: 'Failed to list team reports' });
  }
});

router.get('/manager/team/:id', requireManager, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const salesUsers = await managerTeamSalesUsers(req.manager._id);
    const teamIdSet = new Set(salesUsers.map((u) => String(u._id)));
    if (teamIdSet.size === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const report = await DailyReports.findById(id).populate('user', 'name phone company').lean();
    if (!report || !teamIdSet.has(String(report.user?._id || report.user))) {
      return res.status(404).json({ error: 'Report not found' });
    }

    return res.json({ report });
  } catch {
    return res.status(500).json({ error: 'Failed to load team report' });
  }
});

router.put('/manager/team/:id/verification', requireManager, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const { error, update } = buildManagerVerificationUpdate(req.body || {});
  if (error) {
    return res.status(400).json({ error });
  }

  try {
    const salesUsers = await managerTeamSalesUsers(req.manager._id);
    const teamIdSet = new Set(salesUsers.map((u) => String(u._id)));
    if (teamIdSet.size === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const report = await DailyReports.findById(id);
    if (!report || !teamIdSet.has(String(report.user))) {
      return res.status(404).json({ error: 'Report not found' });
    }

    for (const [path, value] of Object.entries(update)) {
      report.set(path, value);
    }
    report.set('managementCheck.verifiedBy', req.manager._id);
    report.set('managementCheck.verifiedAt', new Date());
    await report.save();

    const saved = await DailyReports.findById(id)
      .populate('user', 'name phone company')
      .lean();

    return res.json({ report: saved ?? report });
  } catch (err) {
    const validationError = mapValidationError(err);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    return res.status(500).json({ error: 'Failed to update verification' });
  }
});

router.get('/admin/reports', requireAdmin, async (req, res) => {
  if (req.query?.type && !['indoor', 'outdoor'].includes(req.query.type)) {
    return res.status(400).json({ error: "type must be one of: 'indoor', 'outdoor'" });
  }
  if (req.query?.salesUserId && !mongoose.isValidObjectId(req.query.salesUserId)) {
    return res.status(400).json({ error: 'Invalid salesUserId query' });
  }
  if (req.query?.managerId && !mongoose.isValidObjectId(req.query.managerId)) {
    return res.status(400).json({ error: 'Invalid managerId query' });
  }

  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(1000, Math.trunc(limitRaw)))
    : 300;

  try {
    const filter = {};
    if (req.query?.type) {
      filter.type = req.query.type;
    }
    const ym = parseYearMonth(req.query);
    if (ym) {
      const { start, end } = monthUtcRange(ym.year, ym.month);
      filter.date = { $gte: start, $lt: end };
    } else if (req.query?.date) {
      const date = parseUtcMidnightDate(req.query.date);
      if (!date) return res.status(400).json({ error: 'Invalid date query' });
      filter.date = date;
    }
    if (req.query?.salesUserId) {
      filter.user = req.query.salesUserId;
    }

    let allowedUserIds = null;
    if (req.query?.managerId) {
      const teamUsers = await User.find({
        managerId: req.query.managerId,
        designation: 'sales',
      })
        .select('_id')
        .lean();
      allowedUserIds = teamUsers.map((u) => u._id);
      filter.user = { $in: allowedUserIds };
    }

    const reports = await DailyReports.find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(limit)
      .populate('user', 'name phone managerId company')
      .populate('managementCheck.verifiedBy', 'name phone')
      .lean();

    return res.json({
      reports,
      meta: {
        managerScoped: Boolean(req.query?.managerId),
        managerId: req.query?.managerId || null,
        managerTeamUsersCount: Array.isArray(allowedUserIds) ? allowedUserIds.length : null,
        year: ym?.year ?? null,
        month: ym?.month ?? null,
        date: ym ? null : filter.date ?? null,
      },
    });
  } catch {
    return res.status(500).json({ error: 'Failed to list reports' });
  }
});

router.get('/admin/reports/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const report = await DailyReports.findById(id)
      .populate('user', 'name phone managerId company')
      .populate('managementCheck.verifiedBy', 'name phone')
      .lean();
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    return res.json({ report });
  } catch {
    return res.status(500).json({ error: 'Failed to load report' });
  }
});

router.get('/:id', requireSales, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const report = await DailyReports.findOne({
      _id: id,
      user: req.salesUser._id,
    }).lean();
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    return res.json({ report });
  } catch {
    return res.status(500).json({ error: 'Failed to load daily report' });
  }
});

router.put('/:id', requireSales, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const { error, update } = buildUpdatePayload(req.body || {});
  if (error) {
    return res.status(400).json({ error });
  }

  try {
    const existing = await DailyReports.findOne({
      _id: id,
      user: req.salesUser._id,
    });
    if (!existing) {
      return res.status(404).json({ error: 'Report not found' });
    }

    if (update.dailyTargetAchievement !== undefined) {
      update.dailyTargetAchievement = mergeSalesDailyTargetAchievement(
        existing.dailyTargetAchievement,
        update.dailyTargetAchievement
      );
    }

    existing.set(update);
    await existing.save();
    return res.json({ report: existing });
  } catch (err) {
    const validationError = mapValidationError(err);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    return res.status(500).json({ error: 'Failed to update daily report' });
  }
});

router.delete('/:id', requireSales, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const report = await DailyReports.findOneAndDelete({
      _id: id,
      user: req.salesUser._id,
    });
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(500).json({ error: 'Failed to delete daily report' });
  }
});

module.exports = router;
