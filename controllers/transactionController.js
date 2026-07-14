const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const crypto = require('crypto');
const prisma = new PrismaClient();

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

async function fireReferralCommission(transaction, userId) {
  try {
    if (!transaction.referralCode) return;

    const referral = await prisma.referral.findUnique({
      where: { code: transaction.referralCode },
      include: { superReferral: true },
    });
    if (!referral || !referral.isActive || !referral.isActiveReferral) return;

    const pricing = await getPricing();
    let commission = 0;
    let earningType = 'STANDARD_REG';

    if (transaction.type === 'REGISTRATION') {
      commission = pricing.REFERRAL_STANDARD_REG || 5.00;
      earningType = 'STANDARD_REG';
    } else if (transaction.type === 'RENEWAL') {
      commission = pricing.REFERRAL_STANDARD_RENEWAL || 3.00;
      earningType = 'STANDARD_RENEWAL';
    } else if (transaction.type === 'VAULT_PURCHASE') {
      commission = transaction.amountRM * ((pricing.REFERRAL_VAULT_PERCENT || 10) / 100);
      earningType = 'VAULT_PURCHASE';
    } else if (transaction.type === 'VAULT_RENEWAL') {
      commission = transaction.amountRM * ((pricing.REFERRAL_VAULT_PERCENT || 10) / 100);
      earningType = 'VAULT_RENEWAL';
    } else if (transaction.type === 'PREMIUM_PURCHASE') {
      commission = transaction.amountRM * ((pricing.REFERRAL_VAULT_PERCENT || 10) / 100);
      earningType = 'PREMIUM_PURCHASE';
    } else if (transaction.type === 'PREMIUM_RENEWAL') {
      commission = transaction.amountRM * ((pricing.REFERRAL_VAULT_PERCENT || 10) / 100);
      earningType = 'PREMIUM_RENEWAL';
    }

    if (commission <= 0) return;

    // Calculate override commission
    let overrideCommission = 0;
    let superReferral = null;

    if (referral.superReferralId && referral.superReferral?.isActive && referral.superReferral?.isSuperReferral) {
      superReferral = referral.superReferral;

      if (transaction.type === 'REGISTRATION') {
        overrideCommission = pricing.SUPER_REFERRAL_STANDARD_REG || 2.00;
      } else if (transaction.type === 'RENEWAL') {
        overrideCommission = pricing.SUPER_REFERRAL_STANDARD_RENEWAL || 1.00;
      } else if (['VAULT_PURCHASE', 'VAULT_RENEWAL', 'PREMIUM_PURCHASE', 'PREMIUM_RENEWAL'].includes(transaction.type)) {
        overrideCommission = transaction.amountRM * ((pricing.SUPER_REFERRAL_VAULT_PERCENT || 3) / 100);
      }
    }

    // Create ReferralEarning record
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

    // Update direct referral totalEarnings
    await prisma.referral.update({
      where: { id: referral.id },
      data: { totalEarnings: { increment: commission } },
    });

    // Update Super Referral totalOverrideEarnings
    if (superReferral && overrideCommission > 0) {
      await prisma.referral.update({
        where: { id: superReferral.id },
        data: { totalOverrideEarnings: { increment: overrideCommission } },
      });
    }

    // Update transaction with commission amount
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

    // Global duplicate guard — if already SUCCESS, return 200 immediately
    if (transaction.status === 'SUCCESS') {
      console.log('Duplicate callback ignored — already SUCCESS:', transaction.id);
      return res.status(200).send('OK');
    }

    if (status_id !== '1') {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'FAILED' },
      });
      return res.status(200).send('OK');
    }

    // Handle RENEWAL
    if (transaction.type === 'RENEWAL') {
      const user = await prisma.user.findUnique({ where: { id: transaction.userId } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const newExpiry = new Date(user.registrationExpiry || new Date());
      newExpiry.setFullYear(newExpiry.getFullYear() + 1);

      await prisma.user.update({
        where: { id: user.id },
        data: { registrationExpiry: newExpiry },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'SUCCESS' },
      });

      await fireReferralCommission(transaction, user.id);
      return res.status(200).send('OK');
    }

    // Handle VAULT_PURCHASE
    if (transaction.type === 'VAULT_PURCHASE') {
      const data = transaction.pendingData;

      await prisma.vaultHandle.update({
        where: { id: data.vaultHandleId },
        data: {
          status: 'SOLD',
          ownerId: transaction.userId,
          soldAt: new Date(),
        },
      });

      await prisma.user.update({
        where: { id: transaction.userId },
        data: {
          tier: 'VAULT',
          registrationExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'SUCCESS' },
      });

      await fireReferralCommission(transaction, transaction.userId);
      return res.status(200).send('OK');
    }

    // Handle VAULT_RENEWAL
    if (transaction.type === 'VAULT_RENEWAL') {
      const user = await prisma.user.findUnique({ where: { id: transaction.userId } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const newExpiry = new Date(user.registrationExpiry || new Date());
      newExpiry.setFullYear(newExpiry.getFullYear() + 1);

      await prisma.user.update({
        where: { id: user.id },
        data: { registrationExpiry: newExpiry },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'SUCCESS' },
      });

      await fireReferralCommission(transaction, user.id);
      return res.status(200).send('OK');
    }

    // Handle PREMIUM_PURCHASE
    if (transaction.type === 'PREMIUM_PURCHASE') {
      const data = transaction.pendingData;
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

      const existingHandle = await prisma.handle.findUnique({ where: { name: data.handleName } });
      let handle;
      if (existingHandle) {
        handle = await prisma.handle.update({
          where: { id: existingHandle.id },
          data: { status: 'ACTIVE', ownerId: user.id, isVaultVariant: true },
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
            isVaultVariant: true,
          },
        });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          tier: 'PREMIUM_VARIANT',
          registrationExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
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

    // Handle PREMIUM_RENEWAL
    if (transaction.type === 'PREMIUM_RENEWAL') {
      const user = await prisma.user.findUnique({ where: { id: transaction.userId } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const newExpiry = new Date(user.registrationExpiry || new Date());
      newExpiry.setFullYear(newExpiry.getFullYear() + 1);

      await prisma.user.update({
        where: { id: user.id },
        data: { registrationExpiry: newExpiry },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'SUCCESS' },
      });

      await fireReferralCommission(transaction, user.id);
      return res.status(200).send('OK');
    }

    // Handle REGISTRATION
    const data = transaction.pendingData;

    // Duplicate callback guard — if already SUCCESS, return 200 immediately
    if (transaction.status === 'SUCCESS') {
      console.log('Duplicate callback ignored for transaction:', transaction.id);
      return res.status(200).send('OK');
    }

    // Mark as processing to block concurrent retries
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: 'SUCCESS' },
    });

    const newUser = await prisma.user.create({
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
        tier: 'STANDARD',
      },
    });

    const existingHandle = await prisma.handle.findUnique({
      where: { name: data.handleName },
    });

    let handle;
    if (existingHandle) {
      handle = await prisma.handle.update({
        where: { id: existingHandle.id },
        data: { status: 'ACTIVE', ownerId: newUser.id },
      });
    } else {
      const handleHash = generateHandleHash(
        newUser.id,
        data.handleName,
        data.faceId,
        new Date().toISOString()
      );
      handle = await prisma.handle.create({
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

    await prisma.userProfile.create({
      data: { userId: newUser.id },
    });

    await prisma.trustScore.create({
      data: {
        userId: newUser.id,
        score: 50,
        factors: { verified: true, renewal: false, profileComplete: false },
      },
    });

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'SUCCESS',
        userId: newUser.id,
        handleId: handle.id,
      },
    });

    await fireReferralCommission(transaction, newUser.id);

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

    const billData = {
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_RENEWAL,
      billName: 'LiveID Annual Renewal',
      billDescription: `Annual renewal for liveid.asia/${user.activeHandle.name}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round((renewalAmount + gatewayFee) * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: user.genericId,
      billEmail: user.email,
      billPhone: user.phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for renewing your LiveID.',
    };

    const toyyibResponse = await axios.post(
      'https://toyyibpay.com/index.php/api/createBill',
      new URLSearchParams(billData)
    );

    const billCode = toyyibResponse.data[0]?.BillCode;
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

exports.initiateVaultPurchase = async (req, res) => {
  try {
    const { userId, vaultHandleName } = req.body;
    if (!userId || !vaultHandleName) {
      return res.status(400).json({ error: 'userId and vaultHandleName are required' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const vaultHandle = await prisma.vaultHandle.findUnique({
      where: { name: vaultHandleName.toLowerCase() },
    });
    if (!vaultHandle) return res.status(404).json({ error: 'Vault handle not found' });
    if (vaultHandle.status !== 'AVAILABLE') {
      return res.status(409).json({ error: 'This vault handle is no longer available' });
    }

    const pricing = await getPricing();
    const gatewayFee = pricing.GATEWAY_FEE || 1.00;
    const totalAmount = vaultHandle.buyNowPrice;

    const transaction = await prisma.transaction.create({
      data: {
        type: 'VAULT_PURCHASE',
        status: 'PENDING',
        amountRM: totalAmount,
        userId: user.id,
        referralCode: user.referralCode || null,
        pendingData: {
          userId: user.id,
          vaultHandleId: vaultHandle.id,
          vaultHandleName: vaultHandle.name,
          renewalFee: vaultHandle.renewalFee,
        },
      },
    });

    const billData = {
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_VAULT,
      billName: 'LiveID Vault Purchase',
      billDescription: `Vault handle: liveid.asia/${vaultHandle.name}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round((totalAmount + gatewayFee) * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: user.genericId,
      billEmail: user.email,
      billPhone: user.phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for purchasing your LiveID Vault handle.',
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
    console.error('initiateVaultPurchase error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.initiateVaultRenewal = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { vaultHandle: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.vaultHandle) return res.status(400).json({ error: 'No vault handle found' });

    const pricing = await getPricing();
    const gatewayFee = pricing.GATEWAY_FEE || 1.00;
    const renewalFee = user.vaultHandle.renewalFee;

    const transaction = await prisma.transaction.create({
      data: {
        type: 'VAULT_RENEWAL',
        status: 'PENDING',
        amountRM: renewalFee,
        userId: user.id,
        referralCode: user.referralCode || null,
        pendingData: {
          userId: user.id,
          vaultHandleId: user.vaultHandle.id,
          renewalFee,
        },
      },
    });

    const billData = {
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_VAULT_RENEWAL,
      billName: 'LiveID Vault Renewal',
      billDescription: `Vault handle renewal: liveid.asia/${user.vaultHandle.name}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round((renewalFee + gatewayFee) * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: user.genericId,
      billEmail: user.email,
      billPhone: user.phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for renewing your LiveID Vault handle.',
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
    console.error('initiateVaultRenewal error:', err.message);
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

    const pricing = await getPricing();
    const gatewayFee = pricing.GATEWAY_FEE || 1.00;

    const { calculatePricing } = require('./handleController');
    const cleanName = handleName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const pricingResult = await calculatePricing(cleanName);
    if (!pricingResult) return res.status(400).json({ error: 'Invalid handle format' });

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
          renewalAmount: pricing.ANNUAL_RENEWAL || 28.00,
        },
      },
    });

    const billData = {
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_PREMIUM,
      billName: 'LiveID Premium Purchase',
      billDescription: `Premium handle: liveid.asia/${cleanName}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round((totalAmount + gatewayFee) * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: user.genericId,
      billEmail: user.email,
      billPhone: user.phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for purchasing your LiveID Premium handle.',
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
    const renewalAmount = user.renewalAmount || pricing.ANNUAL_RENEWAL || 28.00;
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

    const billData = {
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_PREMIUM_RENEWAL,
      billName: 'LiveID Premium Renewal',
      billDescription: `Premium handle renewal: liveid.asia/${user.activeHandle.name}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round((renewalAmount + gatewayFee) * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: user.genericId,
      billEmail: user.email,
      billPhone: user.phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for renewing your LiveID Premium handle.',
    };

    const toyyibResponse = await axios.post(
      'https://toyyibpay.com/index.php/api/createBill',
      new URLSearchParams(billData)
    );

    const billCode = toyyibResponse.data[0]?.BillCode;
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