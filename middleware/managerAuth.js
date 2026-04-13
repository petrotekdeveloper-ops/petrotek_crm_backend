const jwt = require('jsonwebtoken');
const User = require('../models/users');

/**
 * Requires a user JWT whose account is an approved manager (verified in DB).
 * Sets `req.user` (payload) and `req.manager` (User document).
 */
async function requireManager(req, res, next) {
  const header = req.headers.authorization;
  const token =
    typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const payload = jwt.verify(token, secret);
    if (payload.role !== 'user' || payload.designation !== 'manager') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const user = await User.findById(payload.sub);
    if (
      !user ||
      user.designation !== 'manager' ||
      (user.approvalStatus ?? 'approved') !== 'approved'
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    req.user = payload;
    req.manager = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireManager };
