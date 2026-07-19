const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const crypto = require('crypto');
const { Resend } = require('resend');
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);
const { sendWelcomeEmail } = require('../utils/welcomeEmail');

function generateHandleHash(userId, handleName, faceId, createdAt) {
  const salt = process.env.HANDLE_HASH_SALT || 'liveid_default_salt';
  const payload = `${userId}|${handleName}|${faceId}|${createdAt}|${salt}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

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

const RENEWAL_KEY_BY_TIER = {
  STANDARD: 'ANNUAL_RENEWAL',
  SPECIAL: 'RENEWAL_SPECIAL',
  SILVER: 'RENEWAL_SILVER',
  GOLDEN: 'RENEWAL_GOLDEN',
};

function getRenewalAmount(tier, pricing) {
  const key = RENEWAL_KEY_BY_TIER[tier] || 'ANNUAL_RENEWAL';
  return pricing[key] || pricing.ANNUAL_RENEWAL || 28;
}

async function fireReferralCommission(transaction, userId) {
  try {
    if (!transaction.referralCode) return;

    const referral = await prisma.referral.findUnique({
      where: { code: transaction.referralCode },
      include: { superReferral: true },
    });
    if (!referral || !referral.isActive || !referral.isActiveReferral) return;

    // ReferralEarning.transactionId is @unique — never double-pay on a retry
    const existingEarning = await prisma.referralEarning.findUnique({
      where: { transactionId: transaction.id },
    });
    if (existingEarning) return;

    const pricing = await getPricing();
    let commission = 0;
    let earningType = 'STANDARD_REG';

    if (transaction.type === 'REGISTRATION') {
      commission = pricing.REFERRAL_STANDARD_REG || 5.00;
      earningType = 'STANDARD_REG';
    } else if (transaction.type === 'RENEWAL') {
      commission = pricing.REFERRAL_STANDARD_RENEWAL || 3.00;
      earningType = 'STANDARD_RENEWAL';
    } else if (transaction.type === 'PREMIUM_PURCHASE') {
      commission = transaction.amountRM * ((pricing.REFERRAL_PREMIUM_PERCENT || 10) / 100);
      earningType = 'PREMIUM_PURCHASE';
    } else if (transaction.type === 'PREMIUM_RENEWAL') {
      commission = transaction.amountRM * ((pricing.REFERRAL_PREMIUM_PERCENT || 10) / 100);
      earningType = 'PREMIUM_RENEWAL';
    } else if (transaction.type === 'TITLE_PURCHASE') {
      commission = transaction.amountRM * ((pricing.REFERRAL_TITLE_PERCENT || 10) / 100);
      earningType = 'TITLE_PURCHASE';
    } else if (transaction.type === 'TITLE_RENEWAL') {
      commission = transaction.amountRM * ((pricing.REFERRAL_TITLE_PERCENT || 10) / 100);
      earningType = 'TITLE_RENEWAL';
    }

    if (commission <= 0) return;

    let overrideCommission = 0;
    let superReferral = null;

    if (referral.superReferralId && referral.superReferral?.isActive && referral.superReferral?.isSuperReferral) {
      superReferral = referral.superReferral;

      if (transaction.type === 'REGISTRATION') {
        overrideCommission = pricing.SUPER_REFERRAL_STANDARD_REG || 2.00;
      } else if (transaction.type === 'RENEWAL') {
        overrideCommission = pricing.SUPER_REFERRAL_STANDARD_RENEWAL || 1.00;
      } else if (['PREMIUM_PURCHASE', 'PREMIUM_RENEWAL'].includes(transaction.type)) {
        overrideCommission = transaction.amountRM * ((pricing.SUPER_REFERRAL_PREMIUM_PERCENT || 3) / 100);
      } else if (['TITLE_PURCHASE', 'TITLE_RENEWAL'].includes(transaction.type)) {
        overrideCommission = transaction.amountRM * ((pricing.SUPER_REFERRAL_TITLE_PERCENT || 3) / 100);
      }
    }

    await prisma.referralEarning.create({
      data: {
        referralId: referral.id,
        transactionId: transaction.id,
        userId,
        amount: commission,
        type: earningType,
        isOverride: false,
        overrideReferralId: superReferral ? superReferral.id : null,
        overrideAmount: overrideCommission > 0 ? overrideCommission : null,
      },
    });

    await prisma.referral.update({
      where: { id: referral.id },
      data: { totalEarnings: { increment: commission } },
    });

    if (superReferral && overrideCommission > 0) {
      await prisma.referral.update({
        where: { id: superReferral.id },
        data: { totalOverrideEarnings: { increment: overrideCommission } },
      });
    }

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { referralCommission: commission },
    });

  } catch (err) {
    console.error('Referral commission error:', err.message);
  }
}

exports.handleCallback = async (req, res) => {
  try {
    console.log('CALLBACK HIT method=%s content-type=%s body=%j query=%j', req.method, req.headers['content-type'], req.body, req.query);

    const source = (req.body && Object.keys(req.body).length) ? req.body : req.query;
    const { billcode, status_id } = source || {};

    if (!billcode) {
      console.error('handleCallback: no billcode. body=', req.body, 'query=', req.query);
      return res.status(400).send('No billcode');
    }

    const transaction = await prisma.transaction.findFirst({
      where: { toyyibRef: billcode },
    });
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    // Duplicate guard — ToyyibPay retries. Already done = 200 and stop.
    if (transaction.status === 'SUCCESS') {
      console.log('Duplicate callback ignored — already SUCCESS:', transaction.id);
      return res.status(200).send('OK');
    }

    if (String(status_id) !== '1') {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'FAILED' },
      });
      return res.status(200).send('OK');
    }

    // ========================================================
    // RENEWAL
    // ========================================================
    if (transaction.type === 'RENEWAL') {
      const user = await prisma.user.findUnique({ where: { id: transaction.userId } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const base = user.registrationExpiry && new Date(user.registrationExpiry) > new Date()
        ? new Date(user.registrationExpiry)
        : new Date();
      base.setFullYear(base.getFullYear() + 1);

      await prisma.user.update({
        where: { id: user.id },
        data: { registrationExpiry: base },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'SUCCESS' },
      });

      await fireReferralCommission(transaction, user.id);
      return res.status(200).send('OK');
    }

    // ========================================================
    // PREMIUM_PURCHASE
    // ========================================================
    if (transaction.type === 'PREMIUM_PURCHASE') {
      const data = transaction.pendingData;
      if (!data?.handleName) {
        console.error('PREMIUM_PURCHASE missing handleName:', transaction.id);
        return res.status(500).json({ error: 'Corrupt transaction data' });
      }

      const user = await prisma.user.findUnique({
        where: { id: transaction.userId },
        include: { activeHandle: true },
      });
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.activeHandle) {
        await prisma.handle.update({
          where: { id: user.activeHandle.id },
          data: { status: 'RETIRED', retiredAt: new Date(), ownerId: null },
        });
      }

      const handleHash = generateHandleHash(user.id, data.handleName, user.faceId, new Date().toISOString());
      const existingHandle = await prisma.handle.findUnique({ where: { name: data.handleName } });

      let handle;
      if (existingHandle) {
        handle = await prisma.handle.update({
          where: { id: existingHandle.id },
          data: {
            baseWord: data.baseWord,
            numberSuffix: data.numberSuffix,
            tier: data.tier,
            price: data.handlePrice,
            status: 'ACTIVE',
            ownerId: user.id,
            handleHash,
            retiredAt: null,
          },
        });
      } else {
        handle = await prisma.handle.create({
          data: {
            name: data.handleName,
            baseWord: data.baseWord,
            numberSuffix: data.numberSuffix,
            tier: data.tier,
            price: data.handlePrice,
            status: 'ACTIVE',
            ownerId: user.id,
            handleHash,
          },
        });
      }

      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 1);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          tier: 'PREMIUM_VARIANT',
          registrationExpiry: expiry,
          renewalAmount: data.renewalAmount,
        },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'SUCCESS', handleId: handle.id },
      });

      await fireReferralCommission(transaction, user.id);
      return res.status(200).send('OK');
    }

    // ========================================================
    // PREMIUM_RENEWAL
    // ========================================================
    if (transaction.type === 'PREMIUM_RENEWAL') {
      const user = await prisma.user.findUnique({ where: { id: transaction.userId } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const base = user.registrationExpiry && new Date(user.registrationExpiry) > new Date()
        ? new Date(user.registrationExpiry)
        : new Date();
      base.setFullYear(base.getFullYear() + 1);

      await prisma.user.update({
        where: { id: user.id },
        data: { registrationExpiry: base },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'SUCCESS' },
      });

      await fireReferralCommission(transaction, user.id);
      return res.status(200).send('OK');
    }

    // ========================================================
    // TITLE_PURCHASE
    // The account already exists. Admin has approved the request
    // and issued this bill. On payment the handle is created and
    // the TitleRequest is marked PAID.
    // ========================================================
    if (transaction.type === 'TITLE_PURCHASE') {
      const data = transaction.pendingData;
      if (!data?.handleName || !data?.titleRequestId) {
        console.error('TITLE_PURCHASE missing data:', transaction.id);
        return res.status(500).json({ error: 'Corrupt transaction data' });
      }

      const user = await prisma.user.findUnique({
        where: { id: transaction.userId },
        include: { activeHandle: true },
      });
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.activeHandle) {
        await prisma.handle.update({
          where: { id: user.activeHandle.id },
          data: { status: 'RETIRED', retiredAt: new Date(), ownerId: null },
        });
      }

      const handleHash = generateHandleHash(user.id, data.handleName, user.faceId, new Date().toISOString());
      const existingHandle = await prisma.handle.findUnique({ where: { name: data.handleName } });

      let handle;
      if (existingHandle) {
        handle = await prisma.handle.update({
          where: { id: existingHandle.id },
          data: {
            baseWord: data.baseWord,
            numberSuffix: data.numberSuffix,
            tier: 'TITLE',
            price: data.titlePrice,
            status: 'ACTIVE',
            ownerId: user.id,
            isTitle: true,
            handleHash,
            retiredAt: null,
          },
        });
      } else {
        handle = await prisma.handle.create({
          data: {
            name: data.handleName,
            baseWord: data.baseWord,
            numberSuffix: data.numberSuffix,
            tier: 'TITLE',
            price: data.titlePrice,
            status: 'ACTIVE',
            ownerId: user.id,
            isTitle: true,
            handleHash,
          },
        });
      }

      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 1);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          tier: 'TITLE',
          registrationExpiry: expiry,
          renewalAmount: data.renewalFee,
        },
      });

      await prisma.titleRequest.update({
        where: { id: data.titleRequestId },
        data: { status: 'PAID', paidAt: new Date() },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'SUCCESS', handleId: handle.id },
      });

      await fireReferralCommission(transaction, user.id);
      return res.status(200).send('OK');
    }

    // ========================================================
    // TITLE_RENEWAL
    // ========================================================
    if (transaction.type === 'TITLE_RENEWAL') {
      const user = await prisma.user.findUnique({ where: { id: transaction.userId } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const base = user.registrationExpiry && new Date(user.registrationExpiry) > new Date()
        ? new Date(user.registrationExpiry)
        : new Date();
      base.setFullYear(base.getFullYear() + 1);

      await prisma.user.update({
        where: { id: user.id },
        data: { registrationExpiry: base },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'SUCCESS' },
      });

      await fireReferralCommission(transaction, user.id);
      return res.status(200).send('OK');
    }

    // ========================================================
    // REGISTRATION
    // Create everything in one transaction. If any step fails,
    // nothing is written and the row stays PENDING so a retry works.
    // ========================================================
    const data = transaction.pendingData;
    if (!data?.phone || !data?.email || !data?.passwordHash || !data?.faceId || !data?.handleName) {
      console.error('REGISTRATION corrupt pendingData:', transaction.id, data);
      return res.status(500).json({ error: 'Corrupt transaction data' });
    }

    console.log('REGISTRATION CALLBACK OK | billcode=%s | handle=%s | email=%s | txn=%s — creating account...',
      billcode, data.handleName, data.email, transaction.id);

    const result = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          genericId: generateGenericId(),
          phone: data.phone,
          email: data.email,
          passwordHash: data.passwordHash,
          faceId: data.faceId,
          isVerified: true,
          verifiedAt: new Date(),
          registrationExpiry: new Date(data.registrationExpiry),
          renewalAmount: data.renewalAmount,
          referralCode: data.referralCode || null,
          tier: data.tier === 'STANDARD' ? 'STANDARD' : 'PREMIUM_VARIANT',
        },
      });

      const handleHash = generateHandleHash(
        newUser.id,
        data.handleName,
        data.faceId,
        new Date().toISOString()
      );

      const existingHandle = await tx.handle.findUnique({
        where: { name: data.handleName },
      });

      let handle;
      if (existingHandle) {
        handle = await tx.handle.update({
          where: { id: existingHandle.id },
          data: {
            baseWord: data.baseWord,
            numberSuffix: data.numberSuffix,
            tier: data.tier,
            price: data.handlePrice,
            status: 'ACTIVE',
            ownerId: newUser.id,
            handleHash,
            retiredAt: null,
          },
        });
      } else {
        handle = await tx.handle.create({
          data: {
            name: data.handleName,
            baseWord: data.baseWord,
            numberSuffix: data.numberSuffix,
            tier: data.tier,
            price: data.handlePrice,
            status: 'ACTIVE',
            ownerId: newUser.id,
            handleHash,
          },
        });
      }

      await tx.userProfile.create({
        data: {
          userId: newUser.id,
          photoUrl: data.photoUrl || null,
        },
      });

      await tx.trustScore.create({
        data: {
          userId: newUser.id,
          score: 50,
          factors: { verified: true, renewal: false, profileComplete: false },
        },
      });

      // Status flips to SUCCESS only after everything above succeeded
      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: 'SUCCESS',
          userId: newUser.id,
          handleId: handle.id,
        },
      });

      return newUser;
    });

    await fireReferralCommission(transaction, result.id);

    // Welcome email — the only channel we can rely on. ToyyibPay's
    // return URL is unreliable, so the user may never see our success
    // page. Everything they need to get set up goes here.
    try {
      await sendWelcomeEmail(data);
      
    } catch (emailErr) {
      // Never fail the callback over an email — the account is already live
      console.error('Welcome email failed:', emailErr.message);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('handleCallback error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.initiateRenewal = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { activeHandle: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.activeHandle) return res.status(400).json({ error: 'No active handle found' });

    const pricing = await getPricing();
    const renewalAmount = user.renewalAmount || pricing.ANNUAL_RENEWAL || 28.00;
    const gatewayFee = pricing.GATEWAY_FEE || 1.00;

    const transaction = await prisma.transaction.create({
      data: {
        type: 'RENEWAL',
        status: 'PENDING',
        amountRM: renewalAmount,
        userId: user.id,
        handleId: user.activeHandle.id,
        referralCode: user.referralCode || null,
        pendingData: {
          userId: user.id,
          renewalAmount,
        },
      },
    });

    const billData = new URLSearchParams({
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_RENEWAL,
      billName: 'LiveID Annual Renewal',
      billDescription: `Annual renewal for liveid.asia/${user.activeHandle.name}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round((renewalAmount + gatewayFee) * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/en/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: user.genericId,
      billEmail: user.email,
      billPhone: user.phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for renewing your LiveID.',
    });

    const toyyibResponse = await axios.post(
      'https://toyyibpay.com/index.php/api/createBill',
      billData.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const billCode = toyyibResponse.data?.[0]?.BillCode;
    if (!billCode) {
      await prisma.transaction.update({ where: { id: transaction.id }, data: { status: 'FAILED' } });
      return res.status(500).json({ error: 'Failed to create renewal bill' });
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
    console.error('initiateRenewal error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.initiatePremiumPurchase = async (req, res) => {
  try {
    const { userId, handleName } = req.body;
    if (!userId || !handleName) {
      return res.status(400).json({ error: 'userId and handleName are required' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const cleanName = handleName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanName) return res.status(400).json({ error: 'Invalid handle name' });

    const existing = await prisma.handle.findUnique({ where: { name: cleanName } });
    if (existing && existing.status === 'ACTIVE') {
      return res.status(409).json({ error: 'This handle is already taken' });
    }

    const pricing = await getPricing();
    const gatewayFee = pricing.GATEWAY_FEE || 1.00;

    const { calculatePricing } = require('./handleController');
    const pricingResult = await calculatePricing(cleanName);
    if (!pricingResult) return res.status(400).json({ error: 'Invalid handle format' });

    // Titles are not buyable through the premium path
    if (pricingResult.blocked) {
      return res.status(403).json({
        error: 'This handle contains a conferred title and requires verification.',
        title: pricingResult.title,
        requestUrl: `/title-request?handle=${cleanName}`,
      });
    }

    const totalAmount = pricingResult.price;

    const transaction = await prisma.transaction.create({
      data: {
        type: 'PREMIUM_PURCHASE',
        status: 'PENDING',
        amountRM: totalAmount,
        userId: user.id,
        referralCode: user.referralCode || null,
        pendingData: {
          userId: user.id,
          handleName: cleanName,
          handlePrice: pricingResult.price,
          tier: pricingResult.tier,
          baseWord: pricingResult.baseWord,
          numberSuffix: pricingResult.numberSuffix,
          renewalAmount: pricingResult.renewalAmount,
        },
      },
    });

    const billData = new URLSearchParams({
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_PREMIUM,
      billName: 'LiveID Premium Purchase',
      billDescription: `Premium handle: liveid.asia/${cleanName}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round((totalAmount + gatewayFee) * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/en/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: user.genericId,
      billEmail: user.email,
      billPhone: user.phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for purchasing your LiveID Premium handle.',
    });

    const toyyibResponse = await axios.post(
      'https://toyyibpay.com/index.php/api/createBill',
      billData.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const billCode = toyyibResponse.data?.[0]?.BillCode;
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
    console.error('initiatePremiumPurchase error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.initiatePremiumRenewal = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { activeHandle: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.activeHandle) return res.status(400).json({ error: 'No active handle found' });
    if (user.tier !== 'PREMIUM_VARIANT') {
      return res.status(400).json({ error: 'User is not on Premium tier' });
    }

    const pricing = await getPricing();
    const renewalAmount = user.renewalAmount || getRenewalAmount(user.activeHandle.tier, pricing);
    const gatewayFee = pricing.GATEWAY_FEE || 1.00;

    const transaction = await prisma.transaction.create({
      data: {
        type: 'PREMIUM_RENEWAL',
        status: 'PENDING',
        amountRM: renewalAmount,
        userId: user.id,
        handleId: user.activeHandle.id,
        referralCode: user.referralCode || null,
        pendingData: {
          userId: user.id,
          renewalAmount,
        },
      },
    });

    const billData = new URLSearchParams({
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_PREMIUM_RENEWAL,
      billName: 'LiveID Premium Renewal',
      billDescription: `Premium handle renewal: liveid.asia/${user.activeHandle.name}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round((renewalAmount + gatewayFee) * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/en/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: user.genericId,
      billEmail: user.email,
      billPhone: user.phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for renewing your LiveID Premium handle.',
    });

    const toyyibResponse = await axios.post(
      'https://toyyibpay.com/index.php/api/createBill',
      billData.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const billCode = toyyibResponse.data?.[0]?.BillCode;
    if (!billCode) {
      await prisma.transaction.update({ where: { id: transaction.id }, data: { status: 'FAILED' } });
      return res.status(500).json({ error: 'Failed to create renewal bill' });
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
    console.error('initiatePremiumRenewal error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// TITLE RENEWAL
// Purchase is initiated by the admin on approval — see titleController.
// ============================================================

exports.initiateTitleRenewal = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { activeHandle: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.activeHandle) return res.status(400).json({ error: 'No active handle found' });
    if (user.tier !== 'TITLE') {
      return res.status(400).json({ error: 'User is not on Title tier' });
    }

    const pricing = await getPricing();
    const percent = pricing.TITLE_RENEWAL_PERCENT || 10;
    const renewalAmount = user.renewalAmount || Math.round(user.activeHandle.price * (percent / 100));
    const gatewayFee = pricing.GATEWAY_FEE || 1.00;

    const transaction = await prisma.transaction.create({
      data: {
        type: 'TITLE_RENEWAL',
        status: 'PENDING',
        amountRM: renewalAmount,
        userId: user.id,
        handleId: user.activeHandle.id,
        referralCode: user.referralCode || null,
        pendingData: {
          userId: user.id,
          renewalAmount,
        },
      },
    });

    const billData = new URLSearchParams({
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_VAULT_RENEWAL,
      billName: 'LiveID Title Renewal',
      billDescription: `Title handle renewal: liveid.asia/${user.activeHandle.name}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round((renewalAmount + gatewayFee) * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/en/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: user.genericId,
      billEmail: user.email,
      billPhone: user.phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for renewing your LiveID Title handle.',
    });

    const toyyibResponse = await axios.post(
      'https://toyyibpay.com/index.php/api/createBill',
      billData.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const billCode = toyyibResponse.data?.[0]?.BillCode;
    if (!billCode) {
      await prisma.transaction.update({ where: { id: transaction.id }, data: { status: 'FAILED' } });
      return res.status(500).json({ error: 'Failed to create renewal bill' });
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
    console.error('initiateTitleRenewal error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getUserTransactions = async (req, res) => {
  try {
    const { userId } = req.params;
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};