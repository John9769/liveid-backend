require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');

const authRoutes = require('./routes/authRoutes');
const handleRoutes = require('./routes/handleRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const referralRoutes = require('./routes/referralRoutes');
const vaultRoutes = require('./routes/vaultRoutes');
const waitlistRoutes = require('./routes/waitlistRoutes');
const profileRoutes = require('./routes/profileRoutes');
const celebrityRoutes = require('./routes/celebrityRoutes');
const pricingRoutes = require('./routes/pricingRoutes');
const adminRoutes = require('./routes/adminRoutes');
const inviteRoutes = require('./routes/inviteRoutes');
require('./cron');

const app = express();
const prisma = new PrismaClient();

// Fail fast — a missing JWT_SECRET breaks every auth route silently
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'FRONTEND_URL', 'BACKEND_URL'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`FATAL: missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

// Render sits behind a proxy — needed for correct IPs in rate limiting and logs
app.set('trust proxy', 1);

// CORS — only our own frontend may call this API from a browser.
// Server-to-server callers (ToyyibPay) send no Origin and are unaffected.
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://liveid.asia',
  'https://www.liveid.asia',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // curl, ToyyibPay, health checks
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (/^https:\/\/liveid-frontend.*\.vercel\.app$/.test(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

// ============================================================
// RATE LIMITS
// ============================================================

// Public verification pages — the most-hit route
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/profiles/public', verifyLimiter);
app.use('/api/handles/verify', verifyLimiter);

// Login and password reset — brute force protection
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/admin/login', authLimiter);

// Registration — selfie upload plus bill creation, expensive per call
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' },
});
app.use('/api/auth/verify-liveness', registerLimiter);
app.use('/api/auth/start-verification', registerLimiter);

// ============================================================
// HEALTH
// ============================================================

app.get('/', (req, res) => {
  res.json({ status: 'LiveID backend running' });
});

app.get('/health/db', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ db: 'connected' });
  } catch (err) {
    res.status(500).json({ db: 'error', message: err.message });
  }
});

// ============================================================
// ROUTES
// ============================================================

app.use('/api/auth', authRoutes);
app.use('/api/handles', handleRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/celebrities', celebrityRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/invites', inviteRoutes);

// ============================================================
// 404 + ERROR HANDLER
// Must be last. Without these, multer and CORS errors crash
// the request with an HTML stack trace instead of JSON.
// ============================================================

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum size is 8MB.' });
  }
  if (err.message === 'Only image files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }

  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// STARTUP
// ============================================================

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`LiveID backend running on port ${PORT}`);
});

// Render sends SIGTERM on redeploy — close cleanly so Neon connections are released
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
});

module.exports = { app, prisma };