const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ============================================================
// PUBLIC — Validate a referral code (used by the register page)
// ============================================================

exports.validateReferralCode = async (req, res) => {
  try {
    const { code } = req.params;
    if (!code) return res.json({ valid: false });

    const referral = await prisma.referral.findUnique({
      where: { code: code.toLowerCase() },
    });

    if (!referral || !referral.isActive || !referral.isActiveReferral) {
      return res.json({ valid: false });
    }

    // Name only — never leak contact or bank details on a public route
    res.json({ valid: true, name: referral.name });
  } catch (err) {
    console.error('validateReferralCode error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// AUTHENTICATED — My referral dashboard
// The email in the URL must belong to the token holder.
// ============================================================

exports.getMyDashboard = async (req, res) => {
  try {
    const requestedEmail = decodeURIComponent(req.params.email).toLowerCase();

    // Resolve the caller from the token, never from the URL
    const caller = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { email: true },
    });
    if (!caller) return res.status(404).json({ error: 'User not found' });

    if (caller.email.toLowerCase() !== requestedEmail) {
      return res.status(403).json({ error: 'You can only view your own referral dashboard' });
    }

    const referral = await prisma.referral.findFirst({
      where: { email: caller.email, isActive: true },
      include: {
        superReferral: {
          select: { id: true, name: true, code: true },
        },
        subReferrals: {
          select: {
            id: true, name: true, code: true,
            totalEarnings: true, isActive: true,
          },
        },
        earnings: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        overrideEarnings: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!referral) return res.status(404).json({ error: 'Not a referral' });

    const totalRegistrations = referral.code
      ? await prisma.transaction.count({
          where: {
            referralCode: referral.code,
            status: 'SUCCESS',
            type: 'REGISTRATION',
          },
        })
      : 0;

    // Strip bank details — the owner does not need them echoed back,
    // and this response is the one most likely to be over-shared.
    const { bankName, bankAccount, bankAccountName, ...safeReferral } = referral;

    res.json({
      referral: safeReferral,
      totalRegistrations,
      unpaidDirect: referral.totalEarnings - referral.totalPaid,
      unpaidOverride: referral.totalOverrideEarnings - referral.totalOverridePaid,
    });
  } catch (err) {
    console.error('getMyDashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — Create referral
// ============================================================

exports.createReferral = async (req, res) => {
  try {
    const {
      name, code, phone, email,
      bankName, bankAccount, bankAccountName,
      isActiveReferral, isSuperReferral,
      superReferralId, minFollowers,
    } = req.body;

    if (!name || !phone || !email) {
      return res.status(400).json({ error: 'name, phone, and email are required' });
    }

    const activeReferral = isActiveReferral !== false; // default true
    const cleanCode = code ? code.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') : null;

    if (activeReferral && !cleanCode) {
      return res.status(400).json({ error: 'code is required for active referrals' });
    }

    if (cleanCode) {
      const existing = await prisma.referral.findUnique({ where: { code: cleanCode } });
      if (existing) return res.status(409).json({ error: 'Referral code already exists' });
    }

    if (superReferralId) {
      const superRef = await prisma.referral.findUnique({ where: { id: superReferralId } });
      if (!superRef) return res.status(404).json({ error: 'Super referral not found' });
      if (!superRef.isSuperReferral) {
        return res.status(400).json({ error: 'Referenced referral is not a super referral' });
      }
    }

    const referral = await prisma.referral.create({
      data: {
        name,
        code: cleanCode,
        phone,
        email,
        bankName: bankName || null,
        bankAccount: bankAccount || null,
        bankAccountName: bankAccountName || null,
        isActiveReferral: activeReferral,
        isSuperReferral: isSuperReferral || false,
        superReferralId: superReferralId || null,
        minFollowers: minFollowers ? parseInt(minFollowers) : null,
      },
    });

    res.status(201).json({ message: 'Referral created', referral });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Referral code already exists' });
    console.error('createReferral error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — List all referrals
// ============================================================

exports.getAllReferrals = async (req, res) => {
  try {
    const referrals = await prisma.referral.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        superReferral: {
          select: { id: true, name: true, code: true },
        },
        subReferrals: {
          select: { id: true, name: true, code: true, isActive: true },
        },
        _count: { select: { earnings: true } },
      },
    });
    res.json({ referrals });
  } catch (err) {
    console.error('getAllReferrals error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — Get one referral
// ============================================================

exports.getReferral = async (req, res) => {
  try {
    const { id } = req.params;
    const referral = await prisma.referral.findUnique({
      where: { id },
      include: {
        superReferral: {
          select: { id: true, name: true, code: true },
        },
        subReferrals: {
          select: { id: true, name: true, code: true, totalEarnings: true, isActive: true },
        },
        earnings: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        overrideEarnings: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });
    res.json({ referral });
  } catch (err) {
    console.error('getReferral error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — Update referral
// ============================================================

exports.updateReferral = async (req, res) => {
  try {
    const { id } = req.params;
    const { bankName, bankAccount, bankAccountName, isActive, minFollowers } = req.body;

    const existing = await prisma.referral.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Referral not found' });

    // Explicit whitelist — only send what was actually provided
    const data = {};
    if (bankName !== undefined) data.bankName = bankName || null;
    if (bankAccount !== undefined) data.bankAccount = bankAccount || null;
    if (bankAccountName !== undefined) data.bankAccountName = bankAccountName || null;
    if (isActive !== undefined) data.isActive = isActive;
    if (minFollowers !== undefined) data.minFollowers = minFollowers ? parseInt(minFollowers) : null;

    const referral = await prisma.referral.update({ where: { id }, data });

    res.json({ message: 'Referral updated', referral });
  } catch (err) {
    console.error('updateReferral error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — Super Referral management
// ============================================================

exports.promoteToSuperReferral = async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await prisma.referral.findUnique({ where: { id } });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });
    if (referral.isSuperReferral) return res.status(409).json({ error: 'Already a super referral' });

    const updated = await prisma.referral.update({
      where: { id },
      data: { isSuperReferral: true },
    });

    res.json({ message: `${referral.name} promoted to Super Referral`, referral: updated });
  } catch (err) {
    console.error('promoteToSuperReferral error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.demoteFromSuperReferral = async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await prisma.referral.findUnique({
      where: { id },
      include: { subReferrals: true },
    });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });
    if (!referral.isSuperReferral) return res.status(409).json({ error: 'Not a super referral' });

    if (referral.subReferrals.length > 0) {
      return res.status(400).json({
        error: `Cannot demote — this super referral has ${referral.subReferrals.length} sub referral(s). Reassign them first.`,
      });
    }

    const updated = await prisma.referral.update({
      where: { id },
      data: { isSuperReferral: false },
    });

    res.json({ message: `${referral.name} demoted from Super Referral`, referral: updated });
  } catch (err) {
    console.error('demoteFromSuperReferral error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.assignSuperReferral = async (req, res) => {
  try {
    const { id } = req.params;
    const { superReferralId } = req.body;

    if (!superReferralId) {
      return res.status(400).json({ error: 'superReferralId is required' });
    }

    if (id === superReferralId) {
      return res.status(400).json({ error: 'Cannot assign referral as their own super referral' });
    }

    const referral = await prisma.referral.findUnique({ where: { id } });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    const superRef = await prisma.referral.findUnique({ where: { id: superReferralId } });
    if (!superRef) return res.status(404).json({ error: 'Super referral not found' });
    if (!superRef.isSuperReferral) return res.status(400).json({ error: 'Target is not a super referral' });

    // Block a cycle — the target must not sit under this referral already
    let cursor = superRef;
    const seen = new Set([id]);
    while (cursor?.superReferralId) {
      if (seen.has(cursor.superReferralId)) {
        return res.status(400).json({ error: 'This assignment would create a referral loop' });
      }
      seen.add(cursor.superReferralId);
      cursor = await prisma.referral.findUnique({ where: { id: cursor.superReferralId } });
    }

    const updated = await prisma.referral.update({
      where: { id },
      data: { superReferralId },
    });

    res.json({
      message: `${referral.name} assigned under Super Referral ${superRef.name}`,
      referral: updated,
    });
  } catch (err) {
    console.error('assignSuperReferral error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.removeSuperReferralAssignment = async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await prisma.referral.findUnique({ where: { id } });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    const updated = await prisma.referral.update({
      where: { id },
      data: { superReferralId: null },
    });

    res.json({ message: 'Super referral assignment removed', referral: updated });
  } catch (err) {
    console.error('removeSuperReferralAssignment error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — Earnings
// ============================================================

exports.getReferralEarnings = async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await prisma.referral.findUnique({ where: { id } });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    const earnings = await prisma.referralEarning.findMany({
      where: { referralId: id },
      orderBy: { createdAt: 'desc' },
    });

    const unpaid = earnings.filter(e => !e.isPaid).reduce((sum, e) => sum + e.amount, 0);
    const paid = earnings.filter(e => e.isPaid).reduce((sum, e) => sum + e.amount, 0);

    res.json({ earnings, unpaid, paid, total: unpaid + paid });
  } catch (err) {
    console.error('getReferralEarnings error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getOverrideEarnings = async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await prisma.referral.findUnique({ where: { id } });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    const overrideEarnings = await prisma.referralEarning.findMany({
      where: { overrideReferralId: id },
      orderBy: { createdAt: 'desc' },
    });

    const unpaid = overrideEarnings
      .filter(e => !e.overrideIsPaid)
      .reduce((sum, e) => sum + (e.overrideAmount || 0), 0);
    const paid = overrideEarnings
      .filter(e => e.overrideIsPaid)
      .reduce((sum, e) => sum + (e.overrideAmount || 0), 0);

    res.json({ overrideEarnings, unpaid, paid, total: unpaid + paid });
  } catch (err) {
    console.error('getOverrideEarnings error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — Payouts
// ============================================================

exports.markPayout = async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await prisma.referral.findUnique({ where: { id } });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    const owed = referral.totalEarnings - referral.totalPaid;
    if (owed <= 0) return res.status(400).json({ error: 'No payout outstanding' });

    await prisma.$transaction([
      prisma.referralEarning.updateMany({
        where: { referralId: id, isPaid: false },
        data: { isPaid: true, paidAt: new Date() },
      }),
      prisma.referral.update({
        where: { id },
        data: { totalPaid: referral.totalEarnings },
      }),
    ]);

    res.json({ message: 'Direct earnings marked as paid', amount: owed });
  } catch (err) {
    console.error('markPayout error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.markOverridePayout = async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await prisma.referral.findUnique({ where: { id } });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    const owed = referral.totalOverrideEarnings - referral.totalOverridePaid;
    if (owed <= 0) return res.status(400).json({ error: 'No override payout outstanding' });

    await prisma.$transaction([
      prisma.referralEarning.updateMany({
        where: { overrideReferralId: id, overrideIsPaid: false },
        data: { overrideIsPaid: true, overridePaidAt: new Date() },
      }),
      prisma.referral.update({
        where: { id },
        data: { totalOverridePaid: referral.totalOverrideEarnings },
      }),
    ]);

    res.json({ message: 'Override earnings marked as paid', amount: owed });
  } catch (err) {
    console.error('markOverridePayout error:', err.message);
    res.status(500).json({ error: err.message });
  }
};