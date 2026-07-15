const { PrismaClient } = require('@prisma/client');
const { Resend } = require('resend');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createHash } = require('crypto');

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

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

    // BOTH is not an invitation role. Nobody starts as both — a REFERRAL
    // becomes both only when the admin promotes them after they recruit.
    if (!['REFERRAL', 'SUPER_REFERRAL'].includes(role)) {
      return res.status(400).json({ error: 'role must be REFERRAL or SUPER_REFERRAL' });
    }

    if (!bankName || !bankAccount || !bankAccountName) {
      return res.status(400).json({ error: 'Bank details are mandatory' });
    }

    const cleanHandle = handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanHandle) return res.status(400).json({ error: 'Invalid handle name' });

    // Vault handles are not free — cannot be given away via invitation
    const vaultHandle = await prisma.vaultHandle.findUnique({ where: { name: cleanHandle } });
    if (vaultHandle) {
      return res.status(409).json({ error: 'This handle belongs to The Vault and cannot be invited' });
    }

    const existingHandle = await prisma.handle.findUnique({ where: { name: cleanHandle } });
    if (existingHandle && existingHandle.status === 'ACTIVE') {
      return res.status(409).json({ error: 'This handle is already taken' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(409).json({ error: 'Email already registered' });

    const existingPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingPhone) return res.status(409).json({ error: 'Phone number already registered' });

    // Only a REFERRAL gets a code, and the code is their handle name.
    // A SUPER_REFERRAL has no code — they never recruit users directly.
    if (role === 'REFERRAL') {
      const existingCode = await prisma.referral.findUnique({ where: { code: cleanHandle } });
      if (existingCode) return res.status(409).json({ error: 'A referral already uses this code' });
    }

    // No duplicate pending invitation for same email
    const existingInvite = await prisma.invitation.findFirst({
      where: { email, isUsed: false, expiresAt: { gt: new Date() } },
    });
    if (existingInvite) {
      return res.status(409).json({ error: 'Active invitation already exists for this email' });
    }

    // No duplicate pending invitation for same handle
    const handleInvite = await prisma.invitation.findFirst({
      where: { handle: cleanHandle, isUsed: false, expiresAt: { gt: new Date() } },
    });
    if (handleInvite) {
      return res.status(409).json({ error: 'This handle is already reserved by another pending invitation' });
    }

    // A super referral can only be assigned to a REFERRAL invite.
    // Super referrals do not sit under other super referrals — one layer only.
    if (superReferralId) {
      if (role !== 'REFERRAL') {
        return res.status(400).json({ error: 'Only a Referral can be placed under a Super Referral' });
      }
      const superRef = await prisma.referral.findUnique({ where: { id: superReferralId } });
      if (!superRef || !superRef.isSuperReferral) {
        return res.status(400).json({ error: 'Invalid super referral' });
      }
      if (!superRef.isActive) {
        return res.status(400).json({ error: 'That super referral is not active' });
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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

    const inviteLink = `${process.env.FRONTEND_URL}/en/invite/${token}`;

    const roleLine = role === 'SUPER_REFERRAL'
      ? 'You are joining as a <strong>Super Referral</strong> — your role is to bring in referrals.'
      : 'You are joining as a <strong>Referral</strong>.';

    await resend.emails.send({
      from: 'LiveID <hello@awas.asia>',
      to: email,
      subject: `You're invited to join LiveID`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #0f172a;">Hi ${name},</h2>
          <p>You have been personally invited to join <strong>LiveID</strong> — the Verified Human Identity Platform.</p>
          <p>${roleLine}</p>
          <p>Your reserved handle: <strong>liveid.asia/${cleanHandle}</strong></p>
          <p>Click the link below to complete your onboarding. You will need to take a quick selfie and set your password.</p>
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
// PUBLIC — Get invitation details (FE loads this on the invite page)
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
// PUBLIC — Accept invitation (selfie + password + create account)
// ============================================================

exports.acceptInvitation = async (req, res) => {
  try {
    const { token } = req.params;
    const { faceId, password, photoUrl } = req.body;

    if (!faceId || !password) {
      return res.status(400).json({ error: 'faceId and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const invitation = await prisma.invitation.findUnique({ where: { token } });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
    if (invitation.isUsed) return res.status(410).json({ error: 'This invitation has already been used' });
    if (new Date() > invitation.expiresAt) return res.status(410).json({ error: 'This invitation has expired' });

    const existingFace = await prisma.user.findUnique({ where: { faceId } });
    if (existingFace) return res.status(409).json({ error: 'This identity is already registered' });

    const existingEmail = await prisma.user.findUnique({ where: { email: invitation.email } });
    if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

    const existingPhone = await prisma.user.findUnique({ where: { phone: invitation.phone } });
    if (existingPhone) return res.status(409).json({ error: 'Phone number already registered' });

    const existingHandle = await prisma.handle.findUnique({ where: { name: invitation.handle } });
    if (existingHandle && existingHandle.status === 'ACTIVE') {
      return res.status(409).json({ error: 'Handle is no longer available' });
    }

    // Role → permissions.
    // REFERRAL       : has a code, earns direct commission from users.
    // SUPER_REFERRAL : no code, no direct sales. Earns override from
    //                  the referrals the admin places under them.
    const isActiveReferral = invitation.role === 'REFERRAL';
    const isSuperReferral = invitation.role === 'SUPER_REFERRAL';
    const referralCode = isActiveReferral ? invitation.handle : null;

    if (referralCode) {
      const codeTaken = await prisma.referral.findUnique({ where: { code: referralCode } });
      if (codeTaken) return res.status(409).json({ error: 'A referral already uses this code' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const randomNum = Math.floor(1000000 + Math.random() * 9000000);
    const genericId = `user${randomNum}`;

    const registrationExpiry = new Date();
    registrationExpiry.setFullYear(registrationExpiry.getFullYear() + 1);

    const handleHash = createHash('sha256')
      .update(`${genericId}${invitation.handle}${faceId}${Date.now()}${process.env.HANDLE_HASH_SALT}`)
      .digest('hex');

    const { calculatePricing } = require('./handleController');
    const pricingResult = await calculatePricing(invitation.handle);

    const pricing = await prisma.pricingConfig.findUnique({ where: { key: 'ANNUAL_RENEWAL' } });
    const renewalAmount = pricing?.value || 28.00;

    // All or nothing — a half-built referral account is worse than none
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
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
          renewalAmount,
        },
      });

      // Handle.ownerId IS the link — there is no User.activeHandleId field.
      let handle;
      if (existingHandle) {
        handle = await tx.handle.update({
          where: { id: existingHandle.id },
          data: {
            status: 'ACTIVE',
            ownerId: user.id,
            handleHash,
            retiredAt: null,
          },
        });
      } else {
        handle = await tx.handle.create({
          data: {
            name: invitation.handle,
            baseWord: pricingResult?.baseWord || invitation.handle,
            numberSuffix: pricingResult?.numberSuffix || null,
            tier: pricingResult?.tier || 'STANDARD',
            price: 0, // free — joining bonus
            status: 'ACTIVE',
            ownerId: user.id,
            handleHash,
          },
        });
      }

      await tx.userProfile.create({
        data: { userId: user.id, photoUrl: photoUrl || null },
      });

      await tx.trustScore.create({
        data: {
          userId: user.id,
          score: 60,
          factors: { verified: true, renewal: false, profileComplete: false },
        },
      });

      await tx.referral.create({
        data: {
          name: invitation.name,
          code: referralCode, // null for a Super Referral
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

      await tx.invitation.update({
        where: { token },
        data: { isUsed: true },
      });

      return { user, handle };
    });

    res.json({
      message: 'Welcome to LiveID. Your account is pending admin activation.',
      userId: result.user.id,
      handle: result.handle.name,
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

    // Never expose live invite tokens through a list endpoint
    const safeInvitations = invitations.map(({ token, ...i }) => ({
      ...i,
      isExpired: new Date() > i.expiresAt,
    }));

    res.json({ invitations: safeInvitations });
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

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.invitation.update({ where: { id }, data: { expiresAt } });

    const inviteLink = `${process.env.FRONTEND_URL}/en/invite/${invitation.token}`;

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

    const invitation = await prisma.invitation.findUnique({ where: { id } });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
    if (invitation.isUsed) return res.status(410).json({ error: 'Invitation already used or revoked' });

    await prisma.invitation.update({
      where: { id },
      data: { isUsed: true },
    });

    res.json({ message: 'Invitation revoked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};