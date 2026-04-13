const jwt = require('jsonwebtoken');
const User = require('../models/users');

/**
 * Requires `Authorization: Bearer <jwt>` from user login.
 * Sets `req.user` to the decoded payload. Verifies the account is approved in DB.
 */
async function requireUser(req, res, next) {
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
    if (payload.role !== 'user') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const user = await User.findById(payload.sub).select('approvalStatus');
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const status = user.approvalStatus ?? 'approved';
    if (status !== 'approved') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireUser };
