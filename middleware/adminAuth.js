const jwt = require('jsonwebtoken');

module.exports = function adminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Invalid token format' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Admin access only' });
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
};