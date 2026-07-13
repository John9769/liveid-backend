require('dotenv').config();
const express = require('express');
const cors = require('cors');
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
require('./cron');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`LiveID backend running on port ${PORT}`);
});

module.exports = { app, prisma };