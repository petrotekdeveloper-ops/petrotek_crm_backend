const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../models/users');
const MonthlySalesUserTarget = require('../models/monthlySalesUserTarget');
const ServiceLog = require('../models/serviceLog');
const DailySale = require('../models/dailySale');
const { parseSaleDate } = require('../utils/salesHelpers');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();
const BCRYPT_ROUNDS = 10;
const DESIGNATIONS = ['manager', 'sales', 'driver', 'service'];
const COMPANY_VALUES = ['Petrotek', 'Seltec'];
const UAE_PHONE_RE = /^\+971\d{1,9}$/;

function userResponse(doc) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  delete o.password;
  return o;
}

function badUserId(res) {
  return res.status(400).json({ error: 'Invalid user id' });
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

/** Admin sales logs: single day (date=) or whole calendar month (year=&month=). */
function resolveAdminSalesLogsFilter(query) {
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

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = process.env.admin_username ?? process.env.ADMIN_USERNAME;
  const p = process.env.admin_password ?? process.env.ADMIN_PASSWORD;
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({ error: 'Server configuration error' });
  }
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (username !== u || password !== p) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { role: 'admin', sub: 'admin' },
    secret,
    { expiresIn: '7d' }
  );
  res.json({ token });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ role: req.admin.role, sub: req.admin.sub });
});

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    return res.json({ users: users.map((u) => userResponse(u)) });
  } catch {
    return res.status(500).json({ error: 'Failed to list users' });
  }
});

router.get('/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badUserId(res);
  try {
    const user = await User.findById(id).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: userResponse(user) });
  } catch {
    return res.status(500).json({ error: 'Failed to load user' });
  }
});

router.post('/users', requireAdmin, async (req, res) => {
  const {
    name,
    phone,
    email,
    dob,
    designation,
    password,
    managerId,
    vehicleNumber,
    company,
  } =
    req.body || {};

  if (
    name == null ||
    String(name).trim() === '' ||
    phone == null ||
    String(phone).trim() === '' ||
    designation == null ||
    String(designation).trim() === '' ||
    password == null ||
    String(password) === ''
  ) {
    return res.status(400).json({
      error:
        'Required fields: name, phone, designation, password. Email and date of birth are optional. Sales users require managerId; drivers require vehicleNumber.',
    });
  }

  if (!DESIGNATIONS.includes(designation)) {
    return res.status(400).json({
      error: `designation must be one of: ${DESIGNATIONS.join(', ')}`,
    });
  }
  if (!UAE_PHONE_RE.test(String(phone).trim())) {
    return res.status(400).json({ error: 'phone must be in +971 format with up to 9 digits' });
  }
  if (designation === 'driver') {
    if (vehicleNumber == null || String(vehicleNumber).trim() === '') {
      return res.status(400).json({ error: 'vehicleNumber is required for drivers' });
    }
  }
  if (
    designation !== 'manager' &&
    designation !== 'sales' &&
    company != null &&
    String(company).trim() !== ''
  ) {
    return res.status(400).json({ error: 'company can only be provided for manager or sales users' });
  }

  const companyValue =
    company == null || String(company).trim() === '' ? 'Petrotek' : String(company).trim();
  if (
    (designation === 'manager' || designation === 'sales') &&
    !COMPANY_VALUES.includes(companyValue)
  ) {
    return res.status(400).json({
      error: `company must be one of: ${COMPANY_VALUES.join(', ')}`,
    });
  }

  if (designation === 'sales') {
    if (!managerId || String(managerId).trim() === '') {
      return res.status(400).json({ error: 'managerId is required for sales users' });
    }
  } else if (managerId != null && String(managerId).trim() !== '') {
    return res.status(400).json({ error: 'managerId can only be provided for sales users' });
  }

  if (managerId != null && String(managerId).trim() !== '') {
    if (!mongoose.isValidObjectId(managerId)) {
      return res.status(400).json({ error: 'Invalid managerId' });
    }
    const mgr = await User.findById(managerId);
    if (!mgr || mgr.designation !== 'manager') {
      return res.status(400).json({ error: 'managerId must reference a manager' });
    }
  }

  let dobDate;
  if (dob != null && String(dob).trim() !== '') {
    dobDate = new Date(dob);
    if (Number.isNaN(dobDate.getTime())) {
      return res.status(400).json({ error: 'dob must be a valid date' });
    }
  }

  const emailRaw = email == null ? '' : String(email).trim();
  const emailValue = emailRaw === '' ? '' : emailRaw.toLowerCase();

  try {
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    /** Avoid passing `undefined` for optional paths — Mongoose 9 can throw on cast in some cases. */
    const doc = {
      name: String(name).trim(),
      phone: String(phone).trim(),
      designation,
      password: passwordHash,
      approvalStatus: 'approved',
      managerId:
        designation === 'sales' && managerId && String(managerId).trim() !== ''
          ? managerId
          : null,
    };
    if (emailValue) doc.email = emailValue;
    if (dobDate != null) doc.dob = dobDate;
    if (designation === 'manager' || designation === 'sales') {
      doc.company = companyValue;
    }
    if (designation === 'driver') {
      doc.vehicleNumber = String(vehicleNumber).trim();
    }

    const user = await User.create(doc);
    return res.status(201).json({ user: userResponse(user) });
  } catch (err) {
    console.error('[admin] POST /users failed:', err?.message || err);
    if (err?.stack) console.error(err.stack);

    const dup =
      err?.code === 11000 ||
      err?.cause?.code === 11000 ||
      (typeof err?.message === 'string' && err.message.includes('E11000'));
    if (dup) {
      return res.status(409).json({ error: 'Phone number already registered' });
    }
    if (err?.name === 'ValidationError') {
      const msgs = Object.values(err.errors || {})
        .map((e) => e.message)
        .filter(Boolean)
        .join(' ');
      return res.status(400).json({
        error: msgs || 'Validation failed',
      });
    }
    return res.status(500).json({
      error: 'Failed to create user',
      detail: process.env.NODE_ENV !== 'production' ? err?.message : undefined,
    });
  }
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badUserId(res);

  const {
    name,
    phone,
    email,
    dob,
    designation,
    password,
    managerId,
    vehicleNumber,
    approvalStatus,
    company,
  } = req.body || {};
  const updates = {};

  if (name !== undefined) {
    if (String(name).trim() === '') {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    updates.name = String(name).trim();
  }
  if (phone !== undefined) {
    if (String(phone).trim() === '') {
      return res.status(400).json({ error: 'phone cannot be empty' });
    }
    const normalizedPhone = String(phone).trim();
    if (!UAE_PHONE_RE.test(normalizedPhone)) {
      return res.status(400).json({ error: 'phone must be in +971 format with up to 9 digits' });
    }
    updates.phone = normalizedPhone;
  }
  if (email !== undefined) {
    const emailRaw = email == null ? '' : String(email).trim();
    updates.email = emailRaw === '' ? undefined : emailRaw.toLowerCase();
  }
  if (dob !== undefined) {
    const dobDate = new Date(dob);
    if (Number.isNaN(dobDate.getTime())) {
      return res.status(400).json({ error: 'dob must be a valid date' });
    }
    updates.dob = dobDate;
  }
  if (designation !== undefined) {
    if (!DESIGNATIONS.includes(designation)) {
      return res.status(400).json({
        error: `designation must be one of: ${DESIGNATIONS.join(', ')}`,
      });
    }
    updates.designation = designation;
  }
  if (vehicleNumber !== undefined) {
    if (vehicleNumber === null || String(vehicleNumber).trim() === '') {
      updates.vehicleNumber = undefined;
    } else {
      updates.vehicleNumber = String(vehicleNumber).trim();
    }
  }
  if (password !== undefined) {
    if (String(password) === '') {
      return res.status(400).json({ error: 'password cannot be empty' });
    }
    updates.password = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  }
  if (managerId !== undefined) {
    if (managerId === null || managerId === '') {
      updates.managerId = null;
    } else if (!mongoose.isValidObjectId(managerId)) {
      return res.status(400).json({ error: 'Invalid managerId' });
    } else {
      const mgr = await User.findById(managerId);
      if (!mgr || mgr.designation !== 'manager') {
        return res.status(400).json({ error: 'managerId must reference a manager' });
      }
      updates.managerId = managerId;
    }
  }
  if (approvalStatus !== undefined) {
    if (!['pending', 'approved', 'rejected'].includes(approvalStatus)) {
      return res.status(400).json({
        error: 'approvalStatus must be pending, approved, or rejected',
      });
    }
    updates.approvalStatus = approvalStatus;
  }
  if (company !== undefined) {
    if (company === null || String(company).trim() === '') {
      updates.company = undefined;
    } else {
      const companyValue = String(company).trim();
      if (!COMPANY_VALUES.includes(companyValue)) {
        return res.status(400).json({
          error: `company must be one of: ${COMPANY_VALUES.join(', ')}`,
        });
      }
      updates.company = companyValue;
    }
  }

  const currentUser = await User.findById(id).select('designation vehicleNumber managerId company');
  if (!currentUser) return res.status(404).json({ error: 'User not found' });

  const designationToValidate = updates.designation ?? currentUser.designation;
  const resolvedVehicleNumber =
    updates.vehicleNumber !== undefined
      ? updates.vehicleNumber
      : currentUser.vehicleNumber;

  if (
    designationToValidate === 'driver' &&
    (!resolvedVehicleNumber || String(resolvedVehicleNumber).trim() === '')
  ) {
    return res.status(400).json({ error: 'vehicleNumber is required for drivers' });
  }
  if (designationToValidate !== 'driver') {
    updates.vehicleNumber = undefined;
  }
  const resolvedCompany = updates.company !== undefined ? updates.company : currentUser.company;
  if (designationToValidate === 'manager' || designationToValidate === 'sales') {
    if (!resolvedCompany || String(resolvedCompany).trim() === '') {
      updates.company = 'Petrotek';
    }
  } else {
    updates.company = undefined;
  }
  const resolvedManagerId =
    updates.managerId !== undefined ? updates.managerId : currentUser.managerId;
  if (designationToValidate === 'sales') {
    if (!resolvedManagerId) {
      return res.status(400).json({ error: 'managerId is required for sales users' });
    }
  } else {
    updates.managerId = null;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  try {
    const user = await User.findByIdAndUpdate(id, updates, {
      returnDocument: 'after',
      runValidators: true,
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: userResponse(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Phone number already in use' });
    }
    console.error('Admin user update failed:', err);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badUserId(res);
  try {
    const user = await User.findByIdAndDelete(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ message: 'User deleted' });
  } catch {
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

/** Per sales user only (managerId + salesUserId + year + month + targetAmount). */
router.put('/sales-user-targets', requireAdmin, async (req, res) => {
  const { managerId, salesUserId, year, month, targetAmount } = req.body || {};
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!managerId || !mongoose.isValidObjectId(managerId)) {
    return res.status(400).json({ error: 'Valid managerId is required' });
  }
  if (!salesUserId || !mongoose.isValidObjectId(salesUserId)) {
    return res.status(400).json({ error: 'Valid salesUserId is required' });
  }
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return res.status(400).json({ error: 'year and month (1-12) are required' });
  }
  const amt = Number(targetAmount);
  if (!Number.isFinite(amt) || amt < 0) {
    return res.status(400).json({
      error: 'targetAmount must be a non-negative number',
    });
  }

  try {
    const mgr = await User.findById(managerId);
    if (!mgr || mgr.designation !== 'manager') {
      return res.status(400).json({ error: 'managerId must reference a manager' });
    }
    const rep = await User.findById(salesUserId);
    if (
      !rep ||
      rep.designation !== 'sales' ||
      String(rep.managerId) !== String(managerId)
    ) {
      return res.status(400).json({
        error: 'salesUserId must be a sales user under this manager',
      });
    }
    const doc = await MonthlySalesUserTarget.findOneAndUpdate(
      { salesUserId: rep._id, year: y, month: m },
      {
        $set: {
          managerId,
          salesUserId: rep._id,
          year: y,
          month: m,
          targetAmount: amt,
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    return res.json({
      salesUserTarget: {
        managerId: doc.managerId,
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

router.get('/sales-user-targets', requireAdmin, async (req, res) => {
  const { managerId, salesUserId, year, month } = req.query;
  const filter = {};
  if (managerId && mongoose.isValidObjectId(managerId)) {
    filter.managerId = managerId;
  }
  if (salesUserId && mongoose.isValidObjectId(salesUserId)) {
    filter.salesUserId = salesUserId;
  }
  if (year !== undefined && year !== '') {
    const y = parseInt(year, 10);
    if (Number.isFinite(y)) filter.year = y;
  }
  if (month !== undefined && month !== '') {
    const m = parseInt(month, 10);
    if (Number.isFinite(m)) filter.month = m;
  }
  try {
    const salesUserTargets = await MonthlySalesUserTarget.find(filter)
      .sort({ year: -1, month: -1 })
      .lean();
    return res.json({ salesUserTargets });
  } catch {
    return res.status(500).json({ error: 'Failed to list sales user targets' });
  }
});

router.get('/service-users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find({ designation: 'service' })
      .select('_id name phone approvalStatus')
      .sort({ name: 1 })
      .lean();
    return res.json({ serviceUsers: users });
  } catch {
    return res.status(500).json({ error: 'Failed to list service users' });
  }
});

router.get('/service-logs/summary', requireAdmin, async (req, res) => {
  const ym = parseYearMonth(req.query);
  if (!ym) {
    return res.status(400).json({ error: 'Query params year and month (1-12) are required' });
  }
  const { serviceUserId } = req.query;
  if (serviceUserId && !mongoose.isValidObjectId(serviceUserId)) {
    return res.status(400).json({ error: 'Invalid serviceUserId' });
  }

  const { start, end } = monthUtcRange(ym.year, ym.month);
  const match = { date: { $gte: start, $lt: end } };
  if (serviceUserId) {
    match.serviceUserId = new mongoose.Types.ObjectId(serviceUserId);
  }

  try {
    const [totals, statusRows] = await Promise.all([
      ServiceLog.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalLogs: { $sum: 1 },
            totalKm: { $sum: '$km' },
            uniqueCustomers: { $addToSet: '$customer' },
          },
        },
        {
          $project: {
            _id: 0,
            totalLogs: 1,
            totalKm: 1,
            uniqueCustomerCount: { $size: '$uniqueCustomers' },
          },
        },
      ]),
      ServiceLog.aggregate([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } },
        { $sort: { count: -1, status: 1 } },
      ]),
    ]);

    const t = totals[0] || { totalLogs: 0, totalKm: 0, uniqueCustomerCount: 0 };
    return res.json({
      summary: {
        year: ym.year,
        month: ym.month,
        totalLogs: t.totalLogs || 0,
        totalKm: Number(t.totalKm || 0),
        uniqueCustomers: t.uniqueCustomerCount || 0,
        byStatus: statusRows,
      },
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load service log summary' });
  }
});

router.get('/service-logs', requireAdmin, async (req, res) => {
  const ym = parseYearMonth(req.query);
  if (!ym) {
    return res.status(400).json({ error: 'Query params year and month (1-12) are required' });
  }
  const { serviceUserId, status } = req.query;
  if (serviceUserId && !mongoose.isValidObjectId(serviceUserId)) {
    return res.status(400).json({ error: 'Invalid serviceUserId' });
  }

  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(500, Math.trunc(limitRaw)))
    : 200;

  const { start, end } = monthUtcRange(ym.year, ym.month);
  const filter = { date: { $gte: start, $lt: end } };
  if (serviceUserId) filter.serviceUserId = serviceUserId;
  if (status != null && String(status).trim() !== '') filter.status = String(status).trim();

  try {
    const logs = await ServiceLog.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .populate('serviceUserId', 'name phone approvalStatus')
      .lean();
    return res.json({
      serviceLogs: logs.map((row) => ({
        ...row,
        serviceUserName: row.serviceUserId?.name ?? '—',
        serviceUserPhone: row.serviceUserId?.phone ?? '—',
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to list service logs' });
  }
});

router.get('/sales-users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find({ designation: 'sales' })
      .select('_id name phone approvalStatus managerId company')
      .sort({ name: 1 })
      .lean();
    return res.json({ salesUsers: users });
  } catch {
    return res.status(500).json({ error: 'Failed to list sales users' });
  }
});

router.get('/sales-logs/summary', requireAdmin, async (req, res) => {
  const { salesUserId } = req.query;
  const resolved = resolveAdminSalesLogsFilter(req.query);
  if (!resolved) {
    return res.status(400).json({
      error: 'Provide date=YYYY-MM-DD for a single day, or year=YYYY&month=MM (1–12) for a month',
    });
  }
  if (salesUserId && !mongoose.isValidObjectId(salesUserId)) {
    return res.status(400).json({ error: 'Invalid salesUserId' });
  }

  const match = { ...resolved.filter };
  if (salesUserId) {
    match.salesUserId = new mongoose.Types.ObjectId(salesUserId);
  }

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

router.get('/sales-logs', requireAdmin, async (req, res) => {
  const { salesUserId } = req.query;
  const resolved = resolveAdminSalesLogsFilter(req.query);
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

  const filter = { ...resolved.filter };
  if (salesUserId) filter.salesUserId = salesUserId;

  try {
    const logs = await DailySale.find(filter)
      .sort({ saleDate: -1, createdAt: -1 })
      .limit(limit)
      .populate('salesUserId', 'name phone managerId approvalStatus')
      .lean();

    return res.json({
      dailySales: logs.map((row) => ({
        ...row,
        salesUserName: row.salesUserId?.name ?? '—',
        salesUserPhone: row.salesUserId?.phone ?? '—',
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to list daily sales logs' });
  }
});

module.exports = router;
