const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();

// Must match the PricingKey enum in schema.prisma exactly
const VALID_PRICING_KEYS = [
  'REGISTRATION_FEE',
  'STANDARD_HANDLE_BASE',
  'ANNUAL_RENEWAL',
  'REFERRAL_STANDARD_REG',
  'REFERRAL_STANDARD_RENEWAL',
  'REFERRAL_VAULT_PERCENT',
  'GATEWAY_FEE',
  'VAULT_RENEWAL_PERCENT',
  'SUPER_REFERRAL_STANDARD_REG',
  'SUPER_REFERRAL_STANDARD_RENEWAL',
  'SUPER_REFERRAL_VAULT_PERCENT',
];

const VALID_VAULT_OFFER_STATUS = ['PENDING', 'ACCEPTED', 'REJECTED', 'COUNTERED'];
const VALID_WAITLIST_STATUS = ['WAITING', 'NOTIFIED', 'CLAIMED', 'EXPIRED'];
const VALID_CELEBRITY_STATUS = ['PROSPECT', 'CONTACTED', 'NEGOTIATING', 'CLOSED', 'DECLINED'];

// ============================================================
// AUTH
// ============================================================

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

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
    console.error('admin login error:', err.message);
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
    console.error('getOverview error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// USERS
// ============================================================

exports.getUsers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    // activeHandle is a to-one relation — Prisma needs `is:` for nested filters
    const where = search ? {
      OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { genericId: { contains: search, mode: 'insensitive' } },
        { activeHandle: { is: { name: { contains: search, mode: 'insensitive' } } } },
      ],
    } : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { activeHandle: true, profile: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.user.count({ where }),
    ]);

    // Never leak password hashes or reset tokens to the admin panel
    const safeUsers = users.map(({ passwordHash, resetToken, resetTokenExpiry, ...u }) => u);

    res.json({ users: safeUsers, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error('getUsers error:', err.message);
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

    const verifyHits = user.activeHandle
      ? await prisma.verifyLog.count({ where: { handleName: user.activeHandle.name } })
      : 0;

    const { passwordHash, resetToken, resetTokenExpiry, ...safeUser } = user;

    res.json({ user: safeUser, verifyHits });
  } catch (err) {
    console.error('getUserDetail error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// TRANSACTIONS
// ============================================================

exports.getTransactions = async (req, res) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const VALID_TYPES = ['REGISTRATION', 'RENEWAL', 'VAULT_PURCHASE', 'VAULT_RENEWAL', 'PREMIUM_PURCHASE', 'PREMIUM_RENEWAL', 'REFERRAL_PAYOUT'];
    const VALID_STATUS = ['PENDING', 'SUCCESS', 'FAILED'];

    if (type && !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (status && !VALID_STATUS.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUS.join(', ')}` });
    }

    const where = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: { user: { include: { activeHandle: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.transaction.count({ where }),
    ]);

    // pendingData holds password hashes — strip it before sending to the panel
    const safeTransactions = transactions.map((t) => {
      const { pendingData, user, ...rest } = t;
      let safeUser = null;
      if (user) {
        const { passwordHash, resetToken, resetTokenExpiry, ...u } = user;
        safeUser = u;
      }
      return { ...rest, user: safeUser };
    });

    res.json({ transactions: safeTransactions, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error('getTransactions error:', err.message);
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
        superReferral: { select: { id: true, name: true, code: true } },
        subReferrals: { select: { id: true, name: true, code: true, isActive: true, totalEarnings: true } },
        earnings: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ referrals });
  } catch (err) {
    console.error('getReferrals error:', err.message);
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

    const cleanCode = code ? code.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') : null;

    if (cleanCode) {
      const existingCode = await prisma.referral.findUnique({ where: { code: cleanCode } });
      if (existingCode) return res.status(409).json({ error: 'Referral code already exists' });
    }

    if (superReferralId) {
      const superRef = await prisma.referral.findUnique({ where: { id: superReferralId } });
      if (!superRef) return res.status(404).json({ error: 'Super referral not found' });
      if (!superRef.isSuperReferral) return res.status(400).json({ error: 'Target is not a super referral' });
    }

    const referral = await prisma.referral.create({
      data: {
        name, phone, email,
        code: cleanCode,
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
    if (err.code === 'P2002') return res.status(409).json({ error: 'Referral code already exists' });
    console.error('createReferral error:', err.message);
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

    const existing = await prisma.referral.findUnique({ where: { id: referralId } });
    if (!existing) return res.status(404).json({ error: 'Referral not found' });

    const cleanCode = code ? code.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') : null;

    if (cleanCode && cleanCode !== existing.code) {
      const codeTaken = await prisma.referral.findUnique({ where: { code: cleanCode } });
      if (codeTaken) return res.status(409).json({ error: 'Referral code already exists' });
    }

    // Cannot assign a referral as their own super referral
    if (superReferralId && superReferralId === referralId) {
      return res.status(400).json({ error: 'Cannot assign referral as their own super referral' });
    }

    if (superReferralId) {
      const superRef = await prisma.referral.findUnique({ where: { id: superReferralId } });
      if (!superRef) return res.status(404).json({ error: 'Super referral not found' });
      if (!superRef.isSuperReferral) return res.status(400).json({ error: 'Target is not a super referral' });
    }

    // Cannot demote a super referral who still has sub referrals
    if (isSuperReferral === false && existing.isSuperReferral) {
      const subs = await prisma.referral.count({ where: { superReferralId: referralId } });
      if (subs > 0) {
        return res.status(400).json({
          error: `Cannot demote — this super referral has ${subs} sub referral(s). Reassign them first.`,
        });
      }
    }

    const referral = await prisma.referral.update({
      where: { id: referralId },
      data: {
        name: name ?? existing.name,
        phone: phone ?? existing.phone,
        email: email ?? existing.email,
        code: code !== undefined ? cleanCode : existing.code,
        isActiveReferral: isActiveReferral ?? existing.isActiveReferral,
        isSuperReferral: isSuperReferral ?? existing.isSuperReferral,
        superReferralId: superReferralId !== undefined ? (superReferralId || null) : existing.superReferralId,
        minFollowers: minFollowers !== undefined ? (minFollowers ? parseInt(minFollowers) : null) : existing.minFollowers,
        isActive: isActive ?? existing.isActive,
        bankName: bankName ?? existing.bankName,
        bankAccount: bankAccount ?? existing.bankAccount,
        bankAccountName: bankAccountName ?? existing.bankAccountName,
      },
    });

    res.json({ message: 'Referral updated', referral });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Referral code already exists' });
    console.error('updateReferral error:', err.message);
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
      const owed = referral.totalOverrideEarnings - referral.totalOverridePaid;
      if (owed <= 0) return res.status(400).json({ error: 'No override payout outstanding' });

      await prisma.$transaction([
        prisma.referral.update({
          where: { id: referralId },
          data: { totalOverridePaid: referral.totalOverrideEarnings },
        }),
        prisma.referralEarning.updateMany({
          where: { overrideReferralId: referralId, overrideIsPaid: false },
          data: { overrideIsPaid: true, overridePaidAt: new Date() },
        }),
      ]);

      return res.json({ message: 'Override payout marked as paid', amount: owed });
    }

    const owed = referral.totalEarnings - referral.totalPaid;
    if (owed <= 0) return res.status(400).json({ error: 'No payout outstanding' });

    await prisma.$transaction([
      prisma.referral.update({
        where: { id: referralId },
        data: { totalPaid: referral.totalEarnings },
      }),
      prisma.referralEarning.updateMany({
        where: { referralId, isPaid: false },
        data: { isPaid: true, paidAt: new Date() },
      }),
    ]);

    res.json({ message: 'Payout marked as paid', amount: owed });
  } catch (err) {
    console.error('markPayoutPaid error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// VERIFY LOGS
// ============================================================

exports.getVerifyLogs = async (req, res) => {
  try {
    const { handleName, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const where = handleName ? { handleName: { contains: handleName, mode: 'insensitive' } } : {};

    const [logs, total] = await Promise.all([
      prisma.verifyLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.verifyLog.count({ where }),
    ]);

    res.json({ logs, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error('getVerifyLogs error:', err.message);
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
    console.error('getVaultOffers error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.updateVaultOffer = async (req, res) => {
  try {
    const { offerId } = req.params;
    const { status, counterAmount } = req.body;

    if (!status) return res.status(400).json({ error: 'status is required' });
    if (!VALID_VAULT_OFFER_STATUS.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_VAULT_OFFER_STATUS.join(', ')}` });
    }

    let parsedCounter = null;
    if (counterAmount !== undefined && counterAmount !== null && counterAmount !== '') {
      parsedCounter = parseFloat(counterAmount);
      if (isNaN(parsedCounter) || parsedCounter < 0) {
        return res.status(400).json({ error: 'counterAmount must be a number of 0 or more' });
      }
    }

    if (status === 'COUNTERED' && parsedCounter === null) {
      return res.status(400).json({ error: 'counterAmount is required when countering an offer' });
    }

    const existing = await prisma.vaultOffer.findUnique({ where: { id: offerId } });
    if (!existing) return res.status(404).json({ error: 'Offer not found' });

    const offer = await prisma.vaultOffer.update({
      where: { id: offerId },
      data: { status, counterAmount: parsedCounter },
    });

    res.json({ message: 'Offer updated', offer });
  } catch (err) {
    console.error('updateVaultOffer error:', err.message);
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
    console.error('getCelebrities error:', err.message);
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

    if (!name) return res.status(400).json({ error: 'name is required' });

    const celebrity = await prisma.celebrity.create({
      data: {
        name,
        phone: phone || null,
        email: email || null,
        instagram: instagram || null,
        instagramFollowers: instagramFollowers ? parseInt(instagramFollowers) : null,
        tiktok: tiktok || null,
        tiktokFollowers: tiktokFollowers ? parseInt(tiktokFollowers) : null,
        facebook: facebook || null,
        facebookFollowers: facebookFollowers ? parseInt(facebookFollowers) : null,
        totalReach: totalReach ? parseInt(totalReach) : null,
        proposedHandle: proposedHandle ? proposedHandle.trim().toLowerCase() : null,
        proposedPrice: proposedPrice ? parseFloat(proposedPrice) : null,
        renewalFee: renewalFee ? parseFloat(renewalFee) : null,
        notes: notes || null,
        introducedBy: introducedBy || null,
      },
    });

    res.json({ message: 'Celebrity added', celebrity });
  } catch (err) {
    console.error('createCelebrity error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.updateCelebrity = async (req, res) => {
  try {
    const { celebrityId } = req.params;
    const {
      name, phone, email,
      instagram, instagramFollowers,
      tiktok, tiktokFollowers,
      facebook, facebookFollowers,
      totalReach, proposedHandle,
      proposedPrice, renewalFee,
      status, notes, introducedBy,
      contractValue,
    } = req.body;

    const existing = await prisma.celebrity.findUnique({ where: { id: celebrityId } });
    if (!existing) return res.status(404).json({ error: 'Celebrity not found' });

    if (status && !VALID_CELEBRITY_STATUS.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_CELEBRITY_STATUS.join(', ')}` });
    }

    // Explicit whitelist — never spread raw req.body into Prisma
    const data = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone || null;
    if (email !== undefined) data.email = email || null;
    if (instagram !== undefined) data.instagram = instagram || null;
    if (instagramFollowers !== undefined) data.instagramFollowers = instagramFollowers ? parseInt(instagramFollowers) : null;
    if (tiktok !== undefined) data.tiktok = tiktok || null;
    if (tiktokFollowers !== undefined) data.tiktokFollowers = tiktokFollowers ? parseInt(tiktokFollowers) : null;
    if (facebook !== undefined) data.facebook = facebook || null;
    if (facebookFollowers !== undefined) data.facebookFollowers = facebookFollowers ? parseInt(facebookFollowers) : null;
    if (totalReach !== undefined) data.totalReach = totalReach ? parseInt(totalReach) : null;
    if (proposedHandle !== undefined) data.proposedHandle = proposedHandle ? proposedHandle.trim().toLowerCase() : null;
    if (proposedPrice !== undefined) data.proposedPrice = proposedPrice ? parseFloat(proposedPrice) : null;
    if (renewalFee !== undefined) data.renewalFee = renewalFee ? parseFloat(renewalFee) : null;
    if (notes !== undefined) data.notes = notes || null;
    if (introducedBy !== undefined) data.introducedBy = introducedBy || null;
    if (contractValue !== undefined) data.contractValue = contractValue ? parseFloat(contractValue) : null;
    if (status !== undefined) data.status = status;

    // Stamp the close date once, on the transition into CLOSED
    if (status === 'CLOSED' && existing.status !== 'CLOSED') {
      data.dealClosedAt = new Date();
    }

    const celebrity = await prisma.celebrity.update({
      where: { id: celebrityId },
      data,
    });

    res.json({ message: 'Celebrity updated', celebrity });
  } catch (err) {
    console.error('updateCelebrity error:', err.message);
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
    console.error('getWaitlist error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.updateWaitlistStatus = async (req, res) => {
  try {
    const { waitlistId } = req.params;
    const { status } = req.body;

    if (!status) return res.status(400).json({ error: 'status is required' });
    if (!VALID_WAITLIST_STATUS.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_WAITLIST_STATUS.join(', ')}` });
    }

    const existing = await prisma.waitlist.findUnique({ where: { id: waitlistId } });
    if (!existing) return res.status(404).json({ error: 'Waitlist entry not found' });

    const entry = await prisma.waitlist.update({
      where: { id: waitlistId },
      data: { status, notifiedAt: status === 'NOTIFIED' ? new Date() : undefined },
    });

    res.json({ message: 'Waitlist updated', entry });
  } catch (err) {
    console.error('updateWaitlistStatus error:', err.message);
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
    console.error('getPricing error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.updatePricing = async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;

    if (!VALID_PRICING_KEYS.includes(key)) {
      return res.status(400).json({
        error: `Invalid pricing key. Must be one of: ${VALID_PRICING_KEYS.join(', ')}`,
      });
    }

    if (value === undefined || value === null || value === '') {
      return res.status(400).json({ error: 'value is required' });
    }

    const parsedValue = parseFloat(value);
    if (isNaN(parsedValue) || parsedValue < 0) {
      return res.status(400).json({ error: 'value must be a number of 0 or more' });
    }

    if (key.includes('PERCENT') && parsedValue > 100) {
      return res.status(400).json({ error: 'Percentage value cannot exceed 100' });
    }

    const existing = await prisma.pricingConfig.findUnique({ where: { key } });
    if (!existing) {
      return res.status(404).json({ error: `Pricing key ${key} is not seeded in the database` });
    }

    const pricing = await prisma.pricingConfig.update({
      where: { key },
      data: {
        value: parsedValue,
        description: description !== undefined ? description : existing.description,
      },
    });

    res.json({ message: 'Pricing updated', pricing });
  } catch (err) {
    console.error('updatePricing error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// INVITATIONS
// ============================================================

exports.getInvitations = async (req, res) => {
  try {
    const invitations = await prisma.invitation.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Never expose live invite tokens through a list endpoint
    const safeInvitations = invitations.map(({ token, ...i }) => ({
      ...i,
      isExpired: new Date() > i.expiresAt,
    }));

    res.json({ invitations: safeInvitations });
  } catch (err) {
    console.error('getInvitations error:', err.message);
    res.status(500).json({ error: err.message });
  }
};