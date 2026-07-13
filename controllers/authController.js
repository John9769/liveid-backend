const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const { Resend } = require('resend');
const { calculatePricing } = require('./handleController');

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

function generateGenericId() {
  const randomNum = Math.floor(1000000 + Math.random() * 9000000);
  return `user${randomNum}`;
}

async function getPricing() {
  const configs = await prisma.pricingConfig.findMany();
  const map = {};
  configs.forEach(c => map[c.key] = c.value);
  return map;
}

exports.verifyLiveness = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Selfie image is required' });
    }

    const form = new FormData();
    form.append('photo', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const luxandResponse = await axios.post(
      'https://api.luxand.cloud/photo/liveness',
      form,
      {
        headers: {
          ...form.getHeaders(),
          'token': process.env.LUXAND_API_TOKEN,
        },
      }
    );

    const { result, score } = luxandResponse.data;

    if (result !== 'real') {
      return res.status(400).json({ error: 'Liveness check failed. Please try again.' });
    }

    const enrollForm = new FormData();
    enrollForm.append('photo', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    enrollForm.append('name', `liveid_${Date.now()}`);

    const enrollResponse = await axios.post(
      'https://api.luxand.cloud/subject',
      enrollForm,
      {
        headers: {
          ...enrollForm.getHeaders(),
          'token': process.env.LUXAND_API_TOKEN,
        },
      }
    );

    const faceId = enrollResponse.data.id?.toString();
    if (!faceId) {
      return res.status(500).json({ error: 'Failed to enroll face' });
    }

    res.json({ result: 'real', score, faceId });
  } catch (err) {
    console.error('verifyLiveness error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
};

exports.startVerification = async (req, res) => {
  try {
    const { phone, email, password, handleName, faceId, referralCode } = req.body;

    if (!phone || !email || !password || !handleName || !faceId) {
      return res.status(400).json({ error: 'phone, email, password, handleName, and faceId are required' });
    }

    const existingPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingPhone) return res.status(409).json({ error: 'Phone number already registered' });

    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

    const cleanHandle = handleName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const existingHandle = await prisma.handle.findUnique({ where: { name: cleanHandle } });
    if (existingHandle && existingHandle.status === 'ACTIVE') {
      return res.status(409).json({ error: 'This handle is already taken' });
    }

    const existingFace = await prisma.user.findUnique({ where: { faceId } });
    if (existingFace) {
      return res.status(409).json({ error: 'This identity is already registered' });
    }

    // Validate referral code if provided
    let validReferral = null;
    if (referralCode) {
      validReferral = await prisma.referral.findUnique({
        where: { code: referralCode.toLowerCase() },
      });
      // Must be active AND isActiveReferral — Super Referral only cannot be used as referral code
      if (!validReferral || !validReferral.isActive || !validReferral.isActiveReferral) {
        validReferral = null;
      }
    }

    const pricingResult = await calculatePricing(cleanHandle);
    if (!pricingResult) return res.status(400).json({ error: 'Invalid handle format' });

    const pricing = await getPricing();
    const registrationFee = pricing.REGISTRATION_FEE || 6.90;
    const gatewayFee = pricing.GATEWAY_FEE || 1.00;
    const totalAmount = registrationFee + pricingResult.price;

    const passwordHash = await bcrypt.hash(password, 10);

    const registrationExpiry = new Date();
    registrationExpiry.setFullYear(registrationExpiry.getFullYear() + 1);

    const transaction = await prisma.transaction.create({
      data: {
        type: 'REGISTRATION',
        status: 'PENDING',
        amountRM: totalAmount,
        referralCode: validReferral ? validReferral.code : null,
        pendingData: {
          phone,
          email,
          passwordHash,
          faceId,
          handleName: cleanHandle,
          tier: pricingResult.tier,
          handlePrice: pricingResult.price,
          baseWord: pricingResult.baseWord,
          numberSuffix: pricingResult.numberSuffix,
          registrationExpiry: registrationExpiry.toISOString(),
          renewalAmount: pricing.ANNUAL_RENEWAL || 28.00,
          referralCode: validReferral ? validReferral.code : null,
        },
      },
    });

    const billData = {
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_REGISTRATION,
      billName: 'LiveID Registration',
      billDescription: `Identity verification + handle: ${cleanHandle}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round((totalAmount + gatewayFee) * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: 'LiveID User',
      billEmail: email,
      billPhone: phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for registering with LiveID.',
    };

    const toyyibResponse = await axios.post(
      'https://toyyibpay.com/index.php/api/createBill',
      new URLSearchParams(billData)
    );

    const billCode = toyyibResponse.data[0]?.BillCode;
    if (!billCode) {
      await prisma.transaction.update({ where: { id: transaction.id }, data: { status: 'FAILED' } });
      return res.status(500).json({ error: 'Failed to create payment bill' });
    }

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { toyyibRef: billCode },
    });

    res.json({
      transactionId: transaction.id,
      paymentUrl: `https://toyyibpay.com/${billCode}`,
    });
  } catch (err) {
    console.error('startVerification error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
};

exports.checkTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    res.json({
      status: transaction.status,
      paymentUrl: transaction.toyyibRef ? `https://toyyibpay.com/${transaction.toyyibRef}` : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.loginUser = async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'Phone and password are required' });

    const user = await prisma.user.findUnique({ where: { phone }, include: { activeHandle: true } });
    if (!user) return res.status(401).json({ error: 'Invalid phone or password' });

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) return res.status(401).json({ error: 'Invalid phone or password' });

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        genericId: user.genericId,
        tier: user.tier,
        registrationExpiry: user.registrationExpiry,
        activeHandle: user.activeHandle ? user.activeHandle.name : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ message: 'If this email is registered, a reset link has been sent' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({ where: { email }, data: { resetToken, resetTokenExpiry } });

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await resend.emails.send({
      from: 'LiveID <noreply@liveid.asia>',
      to: email,
      subject: 'Reset your LiveID password',
      html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetLink}">${resetLink}</a></p>`,
    });

    res.json({ message: 'If this email is registered, a reset link has been sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });

    const user = await prisma.user.findFirst({
      where: { resetToken: token, resetTokenExpiry: { gt: new Date() } },
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiry: null },
    });

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;
    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'userId, currentPassword, and newPassword are required' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const passwordMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatch) return res.status(401).json({ error: 'Current password is incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

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
      tier: user.tier,
      isVerified: user.isVerified,
      registrationExpiry: user.registrationExpiry,
      activeHandle: user.activeHandle ? user.activeHandle.name : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};