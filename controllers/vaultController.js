const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getVaultHandles = async (req, res) => {
  try {
    const handles = await prisma.vaultHandle.findMany({
      where: { status: 'AVAILABLE' },
      orderBy: { buyNowPrice: 'desc' },
      select: {
        id: true,
        name: true,
        tier: true,
        buyNowPrice: true,
        renewalFee: true,
        status: true,
        // reservePrice NEVER exposed
      },
    });
    res.json({ handles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getVaultHandle = async (req, res) => {
  try {
    const { name } = req.params;
    const handle = await prisma.vaultHandle.findUnique({
      where: { name: name.toLowerCase() },
      select: {
        id: true,
        name: true,
        tier: true,
        buyNowPrice: true,
        renewalFee: true,
        status: true,
        // reservePrice NEVER exposed
      },
    });
    if (!handle) return res.status(404).json({ error: 'Vault handle not found' });
    res.json({ handle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.submitOffer = async (req, res) => {
  try {
    const { name } = req.params;
    const { offerName, phone, email, offerAmount, message } = req.body;

    if (!offerName || !phone || !email || !offerAmount) {
      return res.status(400).json({ error: 'name, phone, email, and offerAmount are required' });
    }

    const handle = await prisma.vaultHandle.findUnique({
      where: { name: name.toLowerCase() },
    });

    if (!handle) return res.status(404).json({ error: 'Vault handle not found' });
    if (handle.status !== 'AVAILABLE') {
      return res.status(409).json({ error: 'This handle is no longer available' });
    }

    // Check against secret reserve price
    if (parseFloat(offerAmount) < handle.reservePrice) {
      return res.json({
        accepted: false,
        message: 'Thank you for your interest. Your offer has not met our reserve price. Please make a better offer.',
      });
    }

    // Offer meets reserve — create offer record, notify admin
    const offer = await prisma.vaultOffer.create({
      data: {
        vaultHandleId: handle.id,
        name: offerName,
        phone,
        email,
        offerAmount: parseFloat(offerAmount),
        message,
        status: 'PENDING',
      },
    });

    res.json({
      accepted: true,
      message: 'Your offer has been received. Our team will contact you within 24 hours.',
      offerId: offer.id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getVaultBillboard = async (req, res) => {
  try {
    // Billboard — name only, no price
    const handles = await prisma.vaultHandle.findMany({
      where: { status: 'AVAILABLE' },
      orderBy: { buyNowPrice: 'desc' },
      select: {
        name: true,
        tier: true,
      },
    });
    res.json({ handles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Admin only
exports.createVaultHandle = async (req, res) => {
  try {
    const { name, tier, baseWord, buyNowPrice, reservePrice, renewalFee } = req.body;

    if (!name || !tier || !baseWord || !buyNowPrice || !reservePrice || !renewalFee) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const handle = await prisma.vaultHandle.create({
      data: {
        name: name.toLowerCase(),
        tier,
        baseWord,
        buyNowPrice: parseFloat(buyNowPrice),
        reservePrice: parseFloat(reservePrice),
        renewalFee: parseFloat(renewalFee),
      },
    });

    res.status(201).json({ message: 'Vault handle created', handle });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Vault handle already exists' });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.getAllVaultHandlesAdmin = async (req, res) => {
  try {
    const handles = await prisma.vaultHandle.findMany({
      orderBy: { buyNowPrice: 'desc' },
      include: { offers: true },
    });
    res.json({ handles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateOfferStatus = async (req, res) => {
  try {
    const { offerId } = req.params;
    const { status, counterAmount } = req.body;

    const offer = await prisma.vaultOffer.update({
      where: { id: offerId },
      data: { status, counterAmount },
    });

    res.json({ message: 'Offer status updated', offer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};