const { PrismaClient } = require('@prisma/client');
const { Resend } = require('resend');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createHash } = require('crypto');
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);
const axios = require('axios');
const FormData = require('form-data');

// ============================================================
// ADMIN — Create and send invitation
// ============================================================

exports.createInvitation = async (req, res) => {
  try {
    const {
      name, phone, email, handle,
      role, superReferralId,
      bankName, bankAccount, bankAccountName,
    } = req.body;

    if (!name || !phone || !email || !handle || !role) {
      return res.status(400).json({ error: 'name, phone, email, handle and role are required' });
    }

    if (!['REFERRAL', 'SUPER_REFERRAL', 'BOTH'].includes(role)) {
      return res.status(400).json({ error: 'role must be REFERRAL, SUPER_REFERRAL, or BOTH' });
    }

    if (!bankName || !bankAccount || !bankAccountName) {
      return res.status(400).json({ error: 'Bank details are mandatory' });
    }

    // Check handle not already taken
    const cleanHandle = handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const existingHandle = await prisma.handle.findUnique({ where: { name: cleanHandle } });
    if (existingHandle && existingHandle.status === 'ACTIVE') {
      return res.status(409).json({ error: 'This handle is already taken' });
    }

    // Check email not already registered
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(409).json({ error: 'Email already registered' });

    // Check no pending invitation for same email
    const existingInvite = await prisma.invitation.findFirst({
      where: { email, isUsed: false, expiresAt: { gt: new Date() } },
    });
    if (existingInvite) return res.status(409).json({ error: 'Active invitation already exists for this email' });

    // Validate superReferralId if provided
    if (superReferralId) {
      const superRef = await prisma.referral.findUnique({ where: { id: superReferralId } });
      if (!superRef || !superRef.isSuperReferral) {
        return res.status(400).json({ error: 'Invalid super referral' });
      }
    }

    // Generate one-time token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await prisma.invitation.create({
      data: {
        token,
        email,
        phone,
        name,
        handle: cleanHandle,
        role,
        superReferralId: superReferralId || null,
        bankName,
        bankAccount,
        bankAccountName,
        expiresAt,
      },
    });

    // Send invitation email
    const inviteLink = `${process.env.FRONTEND_URL}/invite/${token}`;

    await resend.emails.send({
      from: 'LiveID <hello@awas.asia>',
      to: email,
      subject: `You're invited to join LiveID`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #0f172a;">Hi ${name},</h2>
          <p>You have been personally invited to join <strong>LiveID</strong> — the Verified Human Identity Platform.</p>
          <p>Your reserved handle: <strong>liveid.asia/${cleanHandle}</strong></p>
          <p>Click the link below to complete your onboarding. You will need to do a quick liveness check and set your password.</p>
          <a href="${inviteLink}" style="display: inline-block; margin: 24px 0; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
            Complete My Onboarding
          </a>
          <p style="color: #64748b; font-size: 0.85rem;">This link expires in 7 days. Do not share it with anyone.</p>
          <p style="color: #64748b; font-size: 0.85rem;">Powered by LiveID — AWAS Premium Resources (202603141446)</p>
        </div>
      `,
    });

    res.json({
      message: `Invitation sent to ${email}`,
      invitation: {
        id: invitation.id,
        handle: cleanHandle,
        role,
        expiresAt,
      },
    });
  } catch (err) {
    console.error('createInvitation error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// PUBLIC — Get invitation details (FE loads this on invite page)
// ============================================================

exports.getInvitation = async (req, res) => {
  try {
    const { token } = req.params;

    const invitation = await prisma.invitation.findUnique({ where: { token } });

    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
    if (invitation.isUsed) return res.status(410).json({ error: 'This invitation has already been used' });
    if (new Date() > invitation.expiresAt) return res.status(410).json({ error: 'This invitation has expired' });

    res.json({
      name: invitation.name,
      handle: invitation.handle,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// PUBLIC — Accept invitation (liveness + password + create account)
// ============================================================

exports.acceptInvitation = async (req, res) => {
  try {
    const { token } = req.params;
    const { faceId, password } = req.body;

    if (!faceId || !password) {
      return res.status(400).json({ error: 'faceId and password are required' });
    }

    const invitation = await prisma.invitation.findUnique({ where: { token } });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
    if (invitation.isUsed) return res.status(410).json({ error: 'This invitation has already been used' });
    if (new Date() > invitation.expiresAt) return res.status(410).json({ error: 'This invitation has expired' });

    // Check faceId not already registered
    const existingFace = await prisma.user.findUnique({ where: { faceId } });
    if (existingFace) return res.status(409).json({ error: 'This identity is already registered' });

    // Check handle still available
    const existingHandle = await prisma.handle.findUnique({ where: { name: invitation.handle } });
    if (existingHandle && existingHandle.status === 'ACTIVE') {
      return res.status(409).json({ error: 'Handle is no longer available' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Generate genericId
    const randomNum = Math.floor(1000000 + Math.random() * 9000000);
    const genericId = `user${randomNum}`;

    // Registration expiry — 1 year from now
    const registrationExpiry = new Date();
    registrationExpiry.setFullYear(registrationExpiry.getFullYear() + 1);

    // Generate handle hash — SHA-256 seal
    const handleHash = createHash('sha256')
      .update(`${genericId}${invitation.handle}${faceId}${Date.now()}${process.env.HANDLE_HASH_SALT}`)
      .digest('hex');

    // Create user — no payment, no ToyyibPay
    const user = await prisma.user.create({
      data: {
        genericId,
        phone: invitation.phone,
        email: invitation.email,
        passwordHash,
        faceId,
        tier: 'STANDARD',
        isVerified: true,
        verifiedAt: new Date(),
        registrationExpiry,
        renewalAmount: 28.00,
      },
    });

    // Create handle — ACTIVE immediately
    const handle = await prisma.handle.create({
      data: {
        name: invitation.handle,
        baseWord: invitation.handle,
        tier: 'STANDARD',
        price: 0,
        status: 'ACTIVE',
        ownerId: user.id,
        handleHash,
      },
    });

    // Update user activeHandle
    await prisma.user.update({
      where: { id: user.id },
      data: { activeHandleId: handle.id },
    });

    // Create profile
    await prisma.userProfile.create({
      data: { userId: user.id },
    });

    // Create trust score
    await prisma.trustScore.create({
      data: { userId: user.id, score: 60 },
    });

    // Create referral record
    const isActiveReferral = ['REFERRAL', 'BOTH'].includes(invitation.role);
    const isSuperReferral = ['SUPER_REFERRAL', 'BOTH'].includes(invitation.role);

    await prisma.referral.create({
      data: {
        name: invitation.name,
        code: invitation.handle, // handle name IS the referral code
        phone: invitation.phone,
        email: invitation.email,
        bankName: invitation.bankName,
        bankAccount: invitation.bankAccount,
        bankAccountName: invitation.bankAccountName,
        isActiveReferral,
        isSuperReferral,
        superReferralId: invitation.superReferralId || null,
        isActive: false, // Admin must activate after reviewing
      },
    });

    // Mark invitation as used
    await prisma.invitation.update({
      where: { token },
      data: { isUsed: true },
    });

    res.json({
      message: 'Welcome to LiveID. Your account is pending admin activation.',
      userId: user.id,
      handle: invitation.handle,
      genericId,
    });
  } catch (err) {
    console.error('acceptInvitation error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — List all invitations
// ============================================================

exports.getInvitations = async (req, res) => {
  try {
    const invitations = await prisma.invitation.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ invitations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — Resend invitation email
// ============================================================

exports.resendInvitation = async (req, res) => {
  try {
    const { id } = req.params;

    const invitation = await prisma.invitation.findUnique({ where: { id } });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
    if (invitation.isUsed) return res.status(410).json({ error: 'Invitation already used' });

    // Extend expiry by 7 more days
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.invitation.update({ where: { id }, data: { expiresAt } });

    const inviteLink = `${process.env.FRONTEND_URL}/invite/${invitation.token}`;

    await resend.emails.send({
      from: 'LiveID <hello@awas.asia>',
      to: invitation.email,
      subject: `Reminder: Your LiveID invitation is waiting`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #0f172a;">Hi ${invitation.name},</h2>
          <p>This is a reminder that your LiveID invitation is still waiting.</p>
          <p>Your reserved handle: <strong>liveid.asia/${invitation.handle}</strong></p>
          <a href="${inviteLink}" style="display: inline-block; margin: 24px 0; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
            Complete My Onboarding
          </a>
          <p style="color: #64748b; font-size: 0.85rem;">This link now expires in 7 days from today.</p>
          <p style="color: #64748b; font-size: 0.85rem;">Powered by LiveID — AWAS Premium Resources (202603141446)</p>
        </div>
      `,
    });

    res.json({ message: 'Invitation resent', expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — Revoke invitation
// ============================================================

exports.revokeInvitation = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.invitation.update({
      where: { id },
      data: { isUsed: true }, // mark as used = no longer valid
    });
    res.json({ message: 'Invitation revoked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};