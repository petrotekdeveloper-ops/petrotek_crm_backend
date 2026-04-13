const jwt = require('jsonwebtoken');

/**
 * Requires `Authorization: Bearer <jwt>` issued by admin login.
 * Sets `req.admin` to the decoded payload.
 */
function requireAdmin(req, res, next) {
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
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAdmin };
