const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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

    // code is required only if isActiveReferral is true
    const activeReferral = isActiveReferral !== false; // default true
    if (activeReferral && !code) {
      return res.status(400).json({ error: 'code is required for active referrals' });
    }

    // Check code uniqueness if provided
    if (code) {
      const existing = await prisma.referral.findUnique({ where: { code: code.toLowerCase() } });
      if (existing) return res.status(409).json({ error: 'Referral code already exists' });
    }

    // Validate superReferralId if provided
    if (superReferralId) {
      const superRef = await prisma.referral.findUnique({ where: { id: superReferralId } });
      if (!superRef) return res.status(404).json({ error: 'Super referral not found' });
      if (!superRef.isSuperReferral) return res.status(400).json({ error: 'Referenced referral is not a super referral' });
    }

    const referral = await prisma.referral.create({
      data: {
        name,
        code: code ? code.toLowerCase() : null,
        phone,
        email,
        bankName,
        bankAccount,
        bankAccountName,
        isActiveReferral: activeReferral,
        isSuperReferral: isSuperReferral || false,
        superReferralId: superReferralId || null,
        minFollowers: minFollowers || null,
      },
    });

    res.status(201).json({ message: 'Referral created', referral });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

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
    res.status(500).json({ error: err.message });
  }
};

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
    res.status(500).json({ error: err.message });
  }
};

exports.updateReferral = async (req, res) => {
  try {
    const { id } = req.params;
    const { bankName, bankAccount, bankAccountName, isActive, minFollowers } = req.body;

    const referral = await prisma.referral.update({
      where: { id },
      data: { bankName, bankAccount, bankAccountName, isActive, minFollowers },
    });

    res.json({ message: 'Referral updated', referral });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

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

    // Warn if they have sub referrals
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

    // Validate the referral exists
    const referral = await prisma.referral.findUnique({ where: { id } });
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    // Validate the super referral exists and is actually a super referral
    const superRef = await prisma.referral.findUnique({ where: { id: superReferralId } });
    if (!superRef) return res.status(404).json({ error: 'Super referral not found' });
    if (!superRef.isSuperReferral) return res.status(400).json({ error: 'Target is not a super referral' });

    // Prevent self-assignment
    if (id === superReferralId) {
      return res.status(400).json({ error: 'Cannot assign referral as their own super referral' });
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
    res.status(500).json({ error: err.message });
  }
};

exports.getReferralEarnings = async (req, res) => {
  try {
    const { id } = req.params;

    const earnings = await prisma.referralEarning.findMany({
      where: { referralId: id },
      orderBy: { createdAt: 'desc' },
    });

    const unpaid = earnings.filter(e => !e.isPaid).reduce((sum, e) => sum + e.amount, 0);
    const paid = earnings.filter(e => e.isPaid).reduce((sum, e) => sum + e.amount, 0);

    res.json({ earnings, unpaid, paid, total: unpaid + paid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getOverrideEarnings = async (req, res) => {
  try {
    const { id } = req.params;

    // Get all earnings where this referral is the override recipient
    const overrideEarnings = await prisma.referralEarning.findMany({
      where: { overrideReferralId: id },
      orderBy: { createdAt: 'desc' },
    });

    const unpaid = overrideEarnings.filter(e => !e.overrideIsPaid).reduce((sum, e) => sum + (e.overrideAmount || 0), 0);
    const paid = overrideEarnings.filter(e => e.overrideIsPaid).reduce((sum, e) => sum + (e.overrideAmount || 0), 0);

    res.json({ overrideEarnings, unpaid, paid, total: unpaid + paid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.markPayout = async (req, res) => {
  try {
    const { id } = req.params;

    // Mark direct earnings as paid
    await prisma.referralEarning.updateMany({
      where: { referralId: id, isPaid: false },
      data: { isPaid: true, paidAt: new Date() },
    });

    const referral = await prisma.referral.findUnique({ where: { id } });
    await prisma.referral.update({
      where: { id },
      data: { totalPaid: referral.totalEarnings },
    });

    res.json({ message: 'Direct earnings marked as paid' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.markOverridePayout = async (req, res) => {
  try {
    const { id } = req.params;

    // Mark override earnings as paid
    await prisma.referralEarning.updateMany({
      where: { overrideReferralId: id, overrideIsPaid: false },
      data: { overrideIsPaid: true, overridePaidAt: new Date() },
    });

    const referral = await prisma.referral.findUnique({ where: { id } });
    await prisma.referral.update({
      where: { id },
      data: { totalOverridePaid: referral.totalOverrideEarnings },
    });

    res.json({ message: 'Override earnings marked as paid' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.validateReferralCode = async (req, res) => {
  try {
    const { code } = req.params;
    const referral = await prisma.referral.findUnique({
      where: { code: code.toLowerCase() },
    });

    if (!referral || !referral.isActive || !referral.isActiveReferral) {
      return res.json({ valid: false });
    }

    res.json({ valid: true, name: referral.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMyDashboard = async (req, res) => {
  try {
    const { email } = req.params;

    const referral = await prisma.referral.findFirst({
      where: { email: decodeURIComponent(email), isActive: true },
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

    // Count total registrations via this code
    const totalRegistrations = await prisma.transaction.count({
      where: {
        referralCode: referral.code,
        status: 'SUCCESS',
        type: 'REGISTRATION',
      },
    });

    res.json({
      referral,
      totalRegistrations,
      unpaidDirect: referral.totalEarnings - referral.totalPaid,
      unpaidOverride: referral.totalOverrideEarnings - referral.totalOverridePaid,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};