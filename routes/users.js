const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/users');
const { requireUser } = require('../middleware/userAuth');
const { requireManager } = require('../middleware/managerAuth');

const router = express.Router();
const BCRYPT_ROUNDS = 10;

const DESIGNATIONS = ['manager', 'sales', 'driver', 'service'];
const COMPANY_VALUES = ['Petrotek', 'Seltec'];

function signUserToken(user) {
  return jwt.sign(
    {
      role: 'user',
      sub: user._id.toString(),
      designation: user.designation,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function userResponse(userDoc) {
  const o = userDoc.toObject ? userDoc.toObject() : userDoc;
  delete o.password;
  return o;
}

function approvalStatus(user) {
  return user.approvalStatus ?? 'approved';
}

/** Public: approved managers for sales self-registration (minimal fields). */
router.get('/registration-managers', async (req, res) => {
  try {
    const managers = await User.find({
      designation: 'manager',
      approvalStatus: 'approved',
    })
      .select('_id name phone company')
      .sort({ name: 1 })
      .lean();
    return res.json({
      managers: managers.map((m) => ({
        _id: m._id.toString(),
        name: m.name,
        phone: m.phone,
        company: m.company ?? 'Petrotek',
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load managers' });
  }
});

router.post('/register', async (req, res) => {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { name, phone, email, dob, designation, password, managerId, vehicleNumber, company } =
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
        'Required fields: name, phone, designation, password.',
    });
  }

  if (!['sales', 'driver', 'manager', 'service'].includes(designation)) {
    return res.status(400).json({
      error: 'Self-registration is only available for sales, driver, service, or manager roles',
    });
  }

  if (!DESIGNATIONS.includes(designation)) {
    return res.status(400).json({
      error: `designation must be one of: ${DESIGNATIONS.join(', ')}`,
    });
  }

  if (designation !== 'sales' && managerId != null && String(managerId).trim() !== '') {
    return res.status(400).json({
      error: 'managerId can only be provided for sales registrations',
    });
  }
  if (designation !== 'driver' && vehicleNumber != null && String(vehicleNumber).trim() !== '') {
    return res.status(400).json({
      error: 'vehicleNumber can only be provided for driver registrations',
    });
  }
  if (
    designation !== 'manager' &&
    designation !== 'sales' &&
    company != null &&
    String(company).trim() !== ''
  ) {
    return res.status(400).json({
      error: 'company can only be provided for manager or sales registrations',
    });
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

  let dobDate;
  if (dob != null && String(dob).trim() !== '') {
    dobDate = new Date(dob);
    if (Number.isNaN(dobDate.getTime())) {
      return res.status(400).json({ error: 'dob must be a valid date' });
    }
  }

  const emailRaw = email == null ? '' : String(email).trim();
  const emailValue = emailRaw === '' ? undefined : emailRaw.toLowerCase();

  try {
    let resolvedManagerId = null;
    if (designation === 'sales' && managerId && String(managerId).trim() !== '') {
      const manager = await User.findById(managerId);
      if (
        !manager ||
        manager.designation !== 'manager' ||
        approvalStatus(manager) !== 'approved'
      ) {
        return res.status(400).json({
          error: 'Invalid manager or manager is not approved yet',
        });
      }
      resolvedManagerId = manager._id;
    }

    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    const user = await User.create({
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: emailValue,
      dob: dobDate,
      designation,
      company:
        designation === 'manager' || designation === 'sales'
          ? companyValue
          : undefined,
      vehicleNumber:
        designation === 'driver' && vehicleNumber != null && String(vehicleNumber).trim() !== ''
          ? String(vehicleNumber).trim()
          : undefined,
      password: passwordHash,
      managerId: resolvedManagerId,
      approvalStatus: 'pending',
    });

    const message =
      designation === 'driver' || designation === 'service'
        ? 'Registration received. Driver and service accounts are approved by an administrator only.'
        : designation === 'manager'
          ? 'Registration received. Manager accounts are approved by an administrator before you can sign in.'
          : 'Registration received. You can sign in after your manager or an administrator approves your account.';

    return res.status(201).json({
      message,
      user: userResponse(user),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Phone number already registered' });
    }
    return res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { phone, password } = req.body || {};
  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone and password are required' });
  }

  try {
    const user = await User.findOne({
      phone: String(phone).trim(),
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        error: 'No account is registered with this phone number.',
        code: 'PHONE_NOT_REGISTERED',
      });
    }

    const match = await bcrypt.compare(String(password), user.password);
    if (!match) {
      return res.status(401).json({
        error: 'Incorrect password.',
        code: 'INVALID_PASSWORD',
      });
    }

    const status = approvalStatus(user);
    if (status === 'pending') {
      const pendingMsg =
        user.designation === 'driver' ||
        user.designation === 'service' ||
        user.designation === 'manager'
          ? 'Account is pending approval from an administrator'
          : 'Account is pending approval from your manager or an administrator';
      return res.status(403).json({ error: pendingMsg });
    }
    if (status === 'rejected') {
      return res.status(403).json({ error: 'Account registration was not approved' });
    }

    const token = signUserToken(user);
    user.password = undefined;
    return res.json({ token, user: userResponse(user) });
  } catch {
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/manager/pending', requireManager, async (req, res) => {
  try {
    const users = await User.find({
      managerId: req.manager._id,
      designation: 'sales',
      approvalStatus: 'pending',
    })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ users: users.map((u) => userResponse(u)) });
  } catch {
    return res.status(500).json({ error: 'Failed to list pending users' });
  }
});

router.put('/:id/approval', requireManager, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({
      error: 'status must be "approved" or "rejected"',
    });
  }

  try {
    const target = await User.findById(id);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (target.designation !== 'sales') {
      return res.status(403).json({
        error: 'Only sales team members can be approved by a manager',
      });
    }
    if (String(target.managerId) !== String(req.manager._id)) {
      return res.status(403).json({ error: 'Not your team member' });
    }
    if (target.approvalStatus !== 'pending') {
      return res.status(400).json({ error: 'User is not awaiting approval' });
    }

    target.approvalStatus = status;
    await target.save();
    return res.json({ user: userResponse(target) });
  } catch {
    return res.status(500).json({ error: 'Failed to update approval' });
  }
});

router.get('/me', requireUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.json({ user: userResponse(user) });
  } catch {
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

module.exports = router;
