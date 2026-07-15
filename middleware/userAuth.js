const jwt = require('jsonwebtoken');

// Verifies a user JWT. Attaches req.user = { userId, genericId }.
module.exports = function userAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Invalid token format' });

  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Admin tokens must not pass as user tokens
    if (decoded.isAdmin) return res.status(403).json({ error: 'User access only' });
    if (!decoded.userId) return res.status(401).json({ error: 'Invalid token' });

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
};

// Ensures the caller owns the resource. Use AFTER userAuth.
// Checks req.params.userId against the token's userId.
module.exports.ownsResource = function ownsResource(req, res, next) {
  const target = req.params.userId || req.body.userId;
  if (!target) return res.status(400).json({ error: 'userId is required' });
  if (req.user.userId !== target) {
    return res.status(403).json({ error: 'You can only access your own account' });
  }
  next();
};