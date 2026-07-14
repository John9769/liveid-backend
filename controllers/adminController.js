const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();

// ============================================================
// AUTH
// ============================================================

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, isAdmin: true },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// OVERVIEW
// ============================================================

exports.getOverview = async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      totalActiveHandles,
      totalRevenue,
      revenueToday,
      revenueWeek,
      revenueMonth,
      pendingTransactions,
      newUsersToday,
      verifyHitsToday,
      topHandles,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.handle.count({ where: { status: 'ACTIVE' } }),
      prisma.transaction.aggregate({ where: { status: 'SUCCESS' }, _sum: { amountRM: true } }),
      prisma.transaction.aggregate({ where: { status: 'SUCCESS', createdAt: { gte: todayStart } }, _sum: { amountRM: true } }),
      prisma.transaction.aggregate({ where: { status: 'SUCCESS', createdAt: { gte: weekStart } }, _sum: { amountRM: true } }),
      prisma.transaction.aggregate({ where: { status: 'SUCCESS', createdAt: { gte: monthStart } }, _sum: { amountRM: true } }),
      prisma.transaction.count({ where: { status: 'PENDING' } }),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.verifyLog.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.verifyLog.groupBy({
        by: ['handleName'],
        _count: { handleName: true },
        orderBy: { _count: { handleName: 'desc' } },
        take: 10,
      }),
    ]);

    res.json({
      totalUsers,
      totalActiveHandles,
      totalRevenue: totalRevenue._sum.amountRM || 0,
      revenueToday: revenueToday._sum.amountRM || 0,
      revenueWeek: revenueWeek._sum.amountRM || 0,
      revenueMonth: revenueMonth._sum.amountRM || 0,
      pendingTransactions,
      newUsersToday,
      verifyHitsToday,
      topHandles: topHandles.map(h => ({ handle: h.handleName, hits: h._count.handleName })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// USERS
// ============================================================

exports.getUsers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = search ? {
      OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { activeHandle: { name: { contains: search, mode: 'insensitive' } } },
      ],
    } : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { activeHandle: true, profile: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getUserDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        activeHandle: true,
        profile: true,
        trustScore: true,
        transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const verifyHits = await prisma.verifyLog.count({
      where: { handleName: user.activeHandle?.name || '' },
    });

    res.json({ user, verifyHits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// TRANSACTIONS
// ============================================================

exports.getTransactions = async (req, res) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: { user: { include: { activeHandle: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({ transactions, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// REFERRALS
// ============================================================

exports.getReferrals = async (req, res) => {
  try {
    const referrals = await prisma.referral.findMany({
      include: {
        superReferral: true,
        subReferrals: true,
        earnings: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ referrals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createReferral = async (req, res) => {
  try {
    const {
      name, phone, email, code,
      isActiveReferral, isSuperReferral,
      superReferralId, minFollowers,
      bankName, bankAccount, bankAccountName,
    } = req.body;

    if (!name || !phone || !email) {
      return res.status(400).json({ error: 'Name, phone and email are required' });
    }

    const referral = await prisma.referral.create({
      data: {
        name, phone, email,
        code: code || null,
        isActiveReferral: isActiveReferral ?? true,
        isSuperReferral: isSuperReferral ?? false,
        superReferralId: superReferralId || null,
        minFollowers: minFollowers ? parseInt(minFollowers) : null,
        bankName: bankName || null,
        bankAccount: bankAccount || null,
        bankAccountName: bankAccountName || null,
      },
    });

    res.json({ message: 'Referral created', referral });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateReferral = async (req, res) => {
  try {
    const { referralId } = req.params;
    const {
      name, phone, email, code,
      isActiveReferral, isSuperReferral,
      superReferralId, minFollowers, isActive,
      bankName, bankAccount, bankAccountName,
    } = req.body;

    const referral = await prisma.referral.update({
      where: { id: referralId },
      data: {
        name, phone, email,
        code: code || null,
        isActiveReferral,
        isSuperReferral,
        superReferralId: superReferralId || null,
        minFollowers: minFollowers ? parseInt(minFollowers) : null,
        isActive,
        bankName, bankAccount, bankAccountName,
      },
    });

    res.json({ message: 'Referral updated', referral });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.markPayoutPaid = async (req, res) => {
  try {
    const { referralId } = req.params;
    const { type } = req.body; // 'direct' or 'override'

    const referral = await prisma.referral.findUnique({ where: { id: referralId } });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    if (type === 'override') {
      await prisma.referral.update({
        where: { id: referralId },
        data: {
          totalOverridePaid: { increment: referral.totalOverrideEarnings - referral.totalOverridePaid },
        },
      });
      await prisma.referralEarning.updateMany({
        where: { overrideReferralId: referralId, overrideIsPaid: false },
        data: { overrideIsPaid: true, overridePaidAt: new Date() },
      });
    } else {
      await prisma.referral.update({
        where: { id: referralId },
        data: {
          totalPaid: { increment: referral.totalEarnings - referral.totalPaid },
        },
      });
      await prisma.referralEarning.updateMany({
        where: { referralId, isPaid: false },
        data: { isPaid: true, paidAt: new Date() },
      });
    }

    res.json({ message: 'Payout marked as paid' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// VERIFY LOGS
// ============================================================

exports.getVerifyLogs = async (req, res) => {
  try {
    const { handleName, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = handleName ? { handleName: { contains: handleName, mode: 'insensitive' } } : {};

    const [logs, total] = await Promise.all([
      prisma.verifyLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.verifyLog.count({ where }),
    ]);

    res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// VAULT OFFERS
// ============================================================

exports.getVaultOffers = async (req, res) => {
  try {
    const offers = await prisma.vaultOffer.findMany({
      include: { vaultHandle: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ offers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateVaultOffer = async (req, res) => {
  try {
    const { offerId } = req.params;
    const { status, counterAmount } = req.body;

    const offer = await prisma.vaultOffer.update({
      where: { id: offerId },
      data: { status, counterAmount: counterAmount || null },
    });

    res.json({ message: 'Offer updated', offer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// CELEBRITY PIPELINE
// ============================================================

exports.getCelebrities = async (req, res) => {
  try {
    const celebrities = await prisma.celebrity.findMany({
      include: { handles: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ celebrities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createCelebrity = async (req, res) => {
  try {
    const {
      name, phone, email,
      instagram, instagramFollowers,
      tiktok, tiktokFollowers,
      facebook, facebookFollowers,
      totalReach, proposedHandle,
      proposedPrice, renewalFee,
      notes, introducedBy,
    } = req.body;

    const celebrity = await prisma.celebrity.create({
      data: {
        name, phone, email,
        instagram, instagramFollowers: instagramFollowers ? parseInt(instagramFollowers) : null,
        tiktok, tiktokFollowers: tiktokFollowers ? parseInt(tiktokFollowers) : null,
        facebook, facebookFollowers: facebookFollowers ? parseInt(facebookFollowers) : null,
        totalReach: totalReach ? parseInt(totalReach) : null,
        proposedHandle, proposedPrice, renewalFee,
        notes, introducedBy,
      },
    });

    res.json({ message: 'Celebrity added', celebrity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateCelebrity = async (req, res) => {
  try {
    const { celebrityId } = req.params;
    const data = req.body;

    const celebrity = await prisma.celebrity.update({
      where: { id: celebrityId },
      data,
    });

    res.json({ message: 'Celebrity updated', celebrity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// WAITLIST
// ============================================================

exports.getWaitlist = async (req, res) => {
  try {
    const waitlist = await prisma.waitlist.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ waitlist });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateWaitlistStatus = async (req, res) => {
  try {
    const { waitlistId } = req.params;
    const { status } = req.body;

    const entry = await prisma.waitlist.update({
      where: { id: waitlistId },
      data: { status, notifiedAt: status === 'NOTIFIED' ? new Date() : undefined },
    });

    res.json({ message: 'Waitlist updated', entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// PRICING CONFIG
// ============================================================

exports.getPricing = async (req, res) => {
  try {
    const pricing = await prisma.pricingConfig.findMany({ orderBy: { key: 'asc' } });
    res.json({ pricing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updatePricing = async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;

    const pricing = await prisma.pricingConfig.update({
      where: { key },
      data: { value: parseFloat(value), description },
    });

    res.json({ message: 'Pricing updated', pricing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};