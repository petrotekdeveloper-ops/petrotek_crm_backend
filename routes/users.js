const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/users');
const { requireUser } = require('../middleware/userAuth');
const { requireManager } = require('../middleware/managerAuth');

const router = express.Router();
const BCRYPT_ROUNDS = 10;

const DESIGNATIONS = ['manager', 'sales', 'driver'];

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
      .select('_id name phone')
      .sort({ name: 1 })
      .lean();
    return res.json({
      managers: managers.map((m) => ({
        _id: m._id.toString(),
        name: m.name,
        phone: m.phone,
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
        'All fields are required: name, phone, email, dob, designation, password. Sales also require managerId and drivers require vehicleNumber.',
    });
  }

  if (!['sales', 'driver', 'manager'].includes(designation)) {
    return res.status(400).json({
      error: 'Self-registration is only available for sales, driver, or manager roles',
    });
  }

  if (!DESIGNATIONS.includes(designation)) {
    return res.status(400).json({
      error: `designation must be one of: ${DESIGNATIONS.join(', ')}`,
    });
  }

  if (designation === 'sales') {
    if (!managerId || !mongoose.isValidObjectId(managerId)) {
      return res.status(400).json({
        error: 'Sales registrations require a valid managerId',
      });
    }
  }
  if (designation === 'driver') {
    if (vehicleNumber == null || String(vehicleNumber).trim() === '') {
      return res.status(400).json({
        error: 'Driver registrations require vehicleNumber',
      });
    }
  }

  const dobDate = new Date(dob);
  if (Number.isNaN(dobDate.getTime())) {
    return res.status(400).json({ error: 'dob must be a valid date' });
  }

  const emailRaw = email == null ? '' : String(email).trim();
  const emailValue = emailRaw === '' ? undefined : emailRaw.toLowerCase();

  try {
    let resolvedManagerId = null;
    if (designation === 'sales') {
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
      vehicleNumber:
        designation === 'driver' ? String(vehicleNumber).trim() : undefined,
      password: passwordHash,
      managerId: resolvedManagerId,
      approvalStatus: 'pending',
    });

    const message =
      designation === 'driver'
        ? 'Registration received. Driver accounts are approved by an administrator only.'
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
        user.designation === 'driver' || user.designation === 'manager'
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
