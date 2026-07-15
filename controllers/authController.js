require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Resend } = require('resend');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ============================================================
// PRICING HELPER
// ============================================================

async function getPricing() {
  const configs = await prisma.pricingConfig.findMany();
  const map = {};
  for (const c of configs) map[c.key] = c.value;
  return map;
}

// ============================================================
// VERIFY LIVENESS — Selfie upload to Cloudinary (no external vendor)
// ============================================================

exports.verifyLiveness = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    const streamUpload = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'liveid_selfies',
            resource_type: 'image',
            transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });

    const uploadResult = await streamUpload();
    const photoUrl = uploadResult.secure_url;

    const faceId = crypto
      .createHash('sha256')
      .update(`${Date.now()}${Math.random()}${photoUrl}${process.env.HANDLE_HASH_SALT}`)
      .digest('hex');

    res.json({ result: 'real', faceId, photoUrl });
  } catch (err) {
    console.error('verifyLiveness error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// START VERIFICATION — Create ToyyibPay bill
// ============================================================

exports.startVerification = async (req, res) => {
  try {
    const { phone, email, password, handleName, faceId, photoUrl, referralCode } = req.body;

    if (!phone || !email || !password || !handleName || !faceId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const cleanName = handleName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanName) return res.status(400).json({ error: 'Invalid handle name' });

    // Block vault handles from the standard registration path
    const vaultHandle = await prisma.vaultHandle.findUnique({ where: { name: cleanName } });
    if (vaultHandle) {
      return res.status(409).json({ error: 'This handle is only available through The Vault' });
    }

    const existingHandle = await prisma.handle.findUnique({ where: { name: cleanName } });
    if (existingHandle && existingHandle.status === 'ACTIVE') {
      return res.status(409).json({ error: 'Handle already taken' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(409).json({ error: 'Email already registered' });

    const existingPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingPhone) return res.status(409).json({ error: 'Phone number already registered' });

    const existingFace = await prisma.user.findUnique({ where: { faceId } });
    if (existingFace) return res.status(409).json({ error: 'Identity already registered' });

    // Resolve tier/price from the same source of truth the rest of the app uses
    const { calculatePricing } = require('./handleController');
    const pricingResult = await calculatePricing(cleanName);
    if (!pricingResult) return res.status(400).json({ error: 'Invalid handle format' });

    const pricing = await getPricing();
    const registrationFee = pricing.REGISTRATION_FEE || 6.90;
    const gatewayFee = pricing.GATEWAY_FEE || 1.00;
    const handlePrice = pricingResult.price;
    const renewalAmount = pricing.ANNUAL_RENEWAL || 28.00;
    const totalAmount = registrationFee + handlePrice + gatewayFee;

    const passwordHash = await bcrypt.hash(password, 10);

    let referral = null;
    if (referralCode) {
      referral = await prisma.referral.findFirst({
        where: { code: referralCode.toLowerCase(), isActive: true, isActiveReferral: true },
      });
    }

    const registrationExpiry = new Date();
    registrationExpiry.setFullYear(registrationExpiry.getFullYear() + 1);

    const transaction = await prisma.transaction.create({
      data: {
        type: 'REGISTRATION',
        status: 'PENDING',
        amountRM: totalAmount,
        referralCode: referral ? referral.code : null,
        pendingData: {
          phone,
          email,
          passwordHash,
          faceId,
          photoUrl: photoUrl || null,
          handleName: cleanName,
          baseWord: pricingResult.baseWord,
          numberSuffix: pricingResult.numberSuffix,
          tier: pricingResult.tier,
          handlePrice,
          registrationExpiry: registrationExpiry.toISOString(),
          renewalAmount,
          referralCode: referral ? referral.code : null,
        },
      },
    });

    const billData = new URLSearchParams({
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_REGISTRATION,
      billName: 'LiveID Registration',
      billDescription: `LiveID handle registration: ${cleanName}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round(totalAmount * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/en/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: 'LiveID User',
      billEmail: email,
      billPhone: phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for registering with LiveID.',
      billChargeToCustomer: 1,
    });

    const toyyibRes = await axios.post(
      'https://toyyibpay.com/index.php/api/createBill',
      billData.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const billCode = toyyibRes.data?.[0]?.BillCode;
    if (!billCode) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'FAILED' },
      });
      return res.status(500).json({ error: 'Failed to create payment bill' });
    }

    // Schema field is toyyibRef — this is what handleCallback looks up
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { toyyibRef: billCode },
    });

    res.json({
      paymentUrl: `https://toyyibpay.com/${billCode}`,
      transactionId: transaction.id,
    });
  } catch (err) {
    console.error('startVerification error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// CHECK TRANSACTION STATUS
// ============================================================

exports.checkTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ status: transaction.status, type: transaction.type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// LOGIN
// ============================================================

exports.loginUser = async (req, res) => {
  try {
    const source = (req.body && Object.keys(req.body).length) ? req.body : req.query;
    const { phone, password } = source || {};
    if (!phone || !password) return res.status(400).json({ error: 'Phone and password required' });

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { activeHandle: true },
    });

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    res.json({
      id: user.id,
      genericId: user.genericId,
      email: user.email,
      phone: user.phone,
      tier: user.tier,
      isVerified: user.isVerified,
      registrationExpiry: user.registrationExpiry,
      activeHandle: user.activeHandle?.name || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// GET USER PROFILE
// ============================================================

exports.getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { activeHandle: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: user.id,
      genericId: user.genericId,
      email: user.email,
      phone: user.phone,
      tier: user.tier,
      isVerified: user.isVerified,
      registrationExpiry: user.registrationExpiry,
      activeHandle: user.activeHandle?.name || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// FORGOT PASSWORD
// ============================================================

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'No account found with this email' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpiry: expiry },
    });

    const resetLink = `${process.env.FRONTEND_URL}/en/reset-password?token=${token}`;

    await resend.emails.send({
      from: 'LiveID <hello@awas.asia>',
      to: email,
      subject: 'Reset your LiveID password',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Reset your LiveID password</h2>
          <p>Click the link below to reset your password. This link expires in 1 hour.</p>
          <a href="${resetLink}" style="display: inline-block; margin: 24px 0; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
            Reset Password
          </a>
          <p style="color: #64748b; font-size: 0.85rem;">If you did not request this, ignore this email.</p>
          <p style="color: #64748b; font-size: 0.85rem;">Powered by LiveID — AWAS Premium Resources (202603141446)</p>
        </div>
      `,
    });

    res.json({ message: 'Reset email sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// RESET PASSWORD
// ============================================================

exports.resetPassword = async (req, res) => {
  try {
    // Accept both `password` and `newPassword` — FE sends newPassword
    const { token } = req.body;
    const password = req.body.password || req.body.newPassword;

    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });

    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiry: null },
    });

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// CHANGE PASSWORD
// ============================================================

exports.changePassword = async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;
    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// DELETE ACCOUNT
// ============================================================

exports.deleteAccount = async (req, res) => {
  try {
    const { userId } = req.params;
    const { confirmation } = req.body;

    if (confirmation !== 'DELETE') {
      return res.status(400).json({ error: 'Invalid confirmation' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { activeHandle: true, profile: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.profile?.photoUrl) {
      try {
        const publicId = user.profile.photoUrl.split('/').slice(-2).join('/').split('.')[0];
        await cloudinary.uploader.destroy(publicId);
      } catch (err) {
        console.error('Cloudinary delete error:', err.message);
      }
    }

    if (user.activeHandle) {
      await prisma.handle.update({
        where: { id: user.activeHandle.id },
        data: { status: 'RETIRED', ownerId: null, retiredAt: new Date() },
      });
    }

    // ReferralEarning has a required FK to Transaction — clear those first
    await prisma.referralEarning.deleteMany({ where: { userId } });

    if (user.profile) {
      await prisma.userProfile.delete({ where: { userId } });
    }

    await prisma.trustScore.deleteMany({ where: { userId } });
    await prisma.transaction.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });

    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error('deleteAccount error:', err.message);
    res.status(500).json({ error: err.message });
  }
};