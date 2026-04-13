const jwt = require('jsonwebtoken');
const User = require('../models/users');

/**
 * Approved sales user only (JWT + DB check).
 */
async function requireSales(req, res, next) {
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
    if (payload.role !== 'user' || payload.designation !== 'sales') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const user = await User.findById(payload.sub);
    if (
      !user ||
      user.designation !== 'sales' ||
      (user.approvalStatus ?? 'approved') !== 'approved'
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    req.user = payload;
    req.salesUser = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireSales };
