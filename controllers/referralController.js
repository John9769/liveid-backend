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

    // Only an active REFERRAL can bring in users.
    // A Super Referral has no code and never reaches this check.
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
//
// Returns only what this person is entitled to see:
//   - direct block  : only if isActiveReferral
//   - override block: only if isSuperReferral
// A recruit's own income is NEVER exposed to their Super Referral.
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
    });

    if (!referral) return res.status(404).json({ error: 'Not a referral' });

    // ---- Identity block — safe fields only, no bank details ----
    const base = {
      id: referral.id,
      name: referral.name,
      code: referral.code,
      isActiveReferral: referral.isActiveReferral,
      isSuperReferral: referral.isSuperReferral,
    };

    const response = { referral: base };

    // ---- DIRECT BLOCK — only for an active referral ----
    if (referral.isActiveReferral) {
      const earnings = await prisma.referralEarning.findMany({
        where: { referralId: referral.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          amount: true,
          type: true,
          isPaid: true,
          paidAt: true,
          createdAt: true,
        },
      });

      const totalRegistrations = referral.code
        ? await prisma.transaction.count({
            where: {
              referralCode: referral.code,
              status: 'SUCCESS',
              type: 'REGISTRATION',
            },
          })
        : 0;

      response.direct = {
        totalEarnings: referral.totalEarnings,
        totalPaid: referral.totalPaid,
        unpaid: referral.totalEarnings - referral.totalPaid,
        totalRegistrations,
        earnings,
      };
    }

    // ---- OVERRIDE BLOCK — only for a super referral ----
    if (referral.isSuperReferral) {
      const overrideEarnings = await prisma.referralEarning.findMany({
        where: { overrideReferralId: referral.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          overrideAmount: true,
          type: true,
          overrideIsPaid: true,
          overridePaidAt: true,
          createdAt: true,
        },
      });

      // A recruit's totalEarnings is their private income — never sent.
      // Only their name, status, and what THIS super referral earned from them.
      const subs = await prisma.referral.findMany({
        where: { superReferralId: referral.id },
        select: { id: true, name: true, isActive: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });

      const subReferrals = await Promise.all(
        subs.map(async (sub) => {
          const agg = await prisma.referralEarning.aggregate({
            where: { referralId: sub.id, overrideReferralId: referral.id },
            _sum: { overrideAmount: true },
            _count: { id: true },
          });
          return {
            id: sub.id,
            name: sub.name,
            isActive: sub.isActive,
            joinedAt: sub.createdAt,
            myOverrideFromThem: agg._sum.overrideAmount || 0,
            salesCount: agg._count.id || 0,
          };
        })
      );

      response.override = {
        totalEarnings: referral.totalOverrideEarnings,
        totalPaid: referral.totalOverridePaid,
        unpaid: referral.totalOverrideEarnings - referral.totalOverridePaid,
        subReferralCount: subs.length,
        subReferrals,
        earnings: overrideEarnings,
      };
    }

    res.json(response);
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
    const superReferral = isSuperReferral === true;
    const cleanCode = code ? code.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') : null;

    if (activeReferral && !cleanCode) {
      return res.status(400).json({ error: 'code is required for a referral who sells directly' });
    }

    // A super-referral-only account must not carry a code
    if (!activeReferral && cleanCode) {
      return res.status(400).json({ error: 'A Super Referral does not use a referral code' });
    }

    if (cleanCode) {
      const existing = await prisma.referral.findUnique({ where: { code: cleanCode } });
      if (existing) return res.status(409).json({ error: 'Referral code already exists' });
    }

    // One layer only — a super referral never sits under another
    if (superReferralId) {
      if (superReferral && !activeReferral) {
        return res.status(400).json({ error: 'A Super Referral cannot be placed under another Super Referral' });
      }
      const superRef = await prisma.referral.findUnique({ where: { id: superReferralId } });
      if (!superRef) return res.status(404).json({ error: 'Super referral not found' });
      if (!superRef.isSuperReferral) {
        return res.status(400).json({ error: 'Referenced referral is not a super referral' });
      }
    }

    const referral = await prisma.referral.create({
      data: {
        name,
        code: activeReferral ? cleanCode : null,
        phone,
        email,
        bankName: bankName || null,
        bankAccount: bankAccount || null,
        bankAccountName: bankAccountName || null,
        isActiveReferral: activeReferral,
        isSuperReferral: superReferral,
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
          select: { id: true, name: true },
        },
        subReferrals: {
          select: { id: true, name: true, code: true, isActive: true },
        },
        _count: { select: { earnings: true } },
      },
    });

    // A Super Referral has no code — surface the role so the admin
    // panel never renders them as a blank row.
    const withRole = referrals.map((r) => ({
      ...r,
      role: r.isActiveReferral && r.isSuperReferral
        ? 'BOTH'
        : r.isSuperReferral
        ? 'SUPER_REFERRAL'
        : 'REFERRAL',
      unpaidDirect: r.totalEarnings - r.totalPaid,
      unpaidOverride: r.totalOverrideEarnings - r.totalOverridePaid,
    }));

    res.json({ referrals: withRole });
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
          select: { id: true, name: true },
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

    res.json({
      referral: {
        ...referral,
        role: referral.isActiveReferral && referral.isSuperReferral
          ? 'BOTH'
          : referral.isSuperReferral
          ? 'SUPER_REFERRAL'
          : 'REFERRAL',
        unpaidDirect: referral.totalEarnings - referral.totalPaid,
        unpaidOverride: referral.totalOverrideEarnings - referral.totalOverridePaid,
      },
    });
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
//
// Promotion does NOT remove direct earning. Nana keeps her RM5 from
// her own followers and gains override from the referrals placed
// under her. Both streams run in parallel, tracked separately.
// ============================================================

exports.promoteToSuperReferral = async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await prisma.referral.findUnique({ where: { id } });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });
    if (referral.isSuperReferral) return res.status(409).json({ error: 'Already a super referral' });

    // isActiveReferral is deliberately untouched — they keep their code
    // and keep earning direct commission from their own followers.
    const updated = await prisma.referral.update({
      where: { id },
      data: { isSuperReferral: true },
    });

    res.json({
      message: `${referral.name} promoted to Super Referral. Direct earnings unchanged.`,
      referral: updated,
    });
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

    // A super-referral-only account has no code. Demoting them would
    // leave an account that can neither sell nor recruit.
    if (!referral.isActiveReferral) {
      return res.status(400).json({
        error: 'This account is Super Referral only. Demoting would leave it with no role. Deactivate it instead.',
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

    // One layer only. A Super-Referral-only account cannot be placed
    // under another Super Referral.
    if (referral.isSuperReferral && !referral.isActiveReferral) {
      return res.status(400).json({
        error: 'A Super Referral cannot be placed under another Super Referral',
      });
    }

    const superRef = await prisma.referral.findUnique({ where: { id: superReferralId } });
    if (!superRef) return res.status(404).json({ error: 'Super referral not found' });
    if (!superRef.isSuperReferral) return res.status(400).json({ error: 'Target is not a super referral' });
    if (!superRef.isActive) return res.status(400).json({ error: 'That super referral is not active' });

    // Block a cycle — the target must not already sit under this referral
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

    const unpaid = earnings.filter((e) => !e.isPaid).reduce((sum, e) => sum + e.amount, 0);
    const paid = earnings.filter((e) => e.isPaid).reduce((sum, e) => sum + e.amount, 0);

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
      .filter((e) => !e.overrideIsPaid)
      .reduce((sum, e) => sum + (e.overrideAmount || 0), 0);
    const paid = overrideEarnings
      .filter((e) => e.overrideIsPaid)
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