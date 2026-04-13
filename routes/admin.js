const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../models/users');
const MonthlyTeamTarget = require('../models/monthlyTeamTarget');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();
const BCRYPT_ROUNDS = 10;
const DESIGNATIONS = ['manager', 'sales', 'driver'];

function userResponse(doc) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  delete o.password;
  return o;
}

function badUserId(res) {
  return res.status(400).json({ error: 'Invalid user id' });
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
  const { name, phone, email, dob, designation, password, managerId, vehicleNumber } =
    req.body || {};

  if (
    name == null ||
    String(name).trim() === '' ||
    phone == null ||
    String(phone).trim() === '' ||
    email === undefined ||
    dob === undefined ||
    designation == null ||
    String(designation).trim() === '' ||
    password == null ||
    String(password) === ''
  ) {
    return res.status(400).json({
      error:
        'All fields are required: name, phone, email, dob, designation, password (sales may use managerId, drivers require vehicleNumber)',
    });
  }

  if (!DESIGNATIONS.includes(designation)) {
    return res.status(400).json({
      error: `designation must be one of: ${DESIGNATIONS.join(', ')}`,
    });
  }
  if (designation === 'driver') {
    if (vehicleNumber == null || String(vehicleNumber).trim() === '') {
      return res.status(400).json({ error: 'vehicleNumber is required for drivers' });
    }
  }

  if (managerId != null && managerId !== '') {
    if (!mongoose.isValidObjectId(managerId)) {
      return res.status(400).json({ error: 'Invalid managerId' });
    }
    const mgr = await User.findById(managerId);
    if (!mgr || mgr.designation !== 'manager') {
      return res.status(400).json({ error: 'managerId must reference a manager' });
    }
  }

  const dobDate = new Date(dob);
  if (Number.isNaN(dobDate.getTime())) {
    return res.status(400).json({ error: 'dob must be a valid date' });
  }

  const emailRaw = email == null ? '' : String(email).trim();
  const emailValue = emailRaw === '' ? undefined : emailRaw.toLowerCase();

  try {
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    const user = await User.create({
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: emailValue,
      dob: dobDate,
      designation,
      vehicleNumber:
        designation === 'driver' ? String(vehicleNumber).trim() : undefined,
      password: passwordHash,
      managerId:
        designation === 'sales' && managerId && String(managerId).trim() !== ''
          ? managerId
          : null,
      approvalStatus: 'approved',
    });
    return res.status(201).json({ user: userResponse(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Phone number already registered' });
    }
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return badUserId(res);

  const { name, phone, email, dob, designation, password, managerId, vehicleNumber, approvalStatus } =
    req.body || {};
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
    updates.phone = String(phone).trim();
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

  const currentUser = await User.findById(id).select('designation vehicleNumber');
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

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  try {
    const user = await User.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: userResponse(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Phone number already in use' });
    }
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

router.put('/team-targets', requireAdmin, async (req, res) => {
  const { managerId, year, month, targetAmount } = req.body || {};
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!managerId || !mongoose.isValidObjectId(managerId)) {
    return res.status(400).json({ error: 'Valid managerId is required' });
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
    const doc = await MonthlyTeamTarget.findOneAndUpdate(
      { managerId, year: y, month: m },
      {
        $set: {
          managerId,
          year: y,
          month: m,
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

router.get('/team-targets', requireAdmin, async (req, res) => {
  const { managerId, year, month } = req.query;
  const filter = {};
  if (managerId && mongoose.isValidObjectId(managerId)) {
    filter.managerId = managerId;
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
    const teamTargets = await MonthlyTeamTarget.find(filter)
      .sort({ year: -1, month: -1 })
      .lean();
    return res.json({ teamTargets });
  } catch {
    return res.status(500).json({ error: 'Failed to list team targets' });
  }
});

module.exports = router;
