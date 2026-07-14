require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const rateLimit = require('express-rate-limit');
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

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Rate limit — verify page only
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/profiles/public', verifyLimiter);

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`LiveID backend running on port ${PORT}`);
});

module.exports = { app, prisma };