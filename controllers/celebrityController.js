const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.createCelebrity = async (req, res) => {
  try {
    const {
      name, phone, email,
      instagram, instagramFollowers,
      tiktok, tiktokFollowers,
      facebook, facebookFollowers,
      totalReach, proposedHandle, proposedPrice,
      renewalFee, notes, introducedBy, referralId,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });

    const celebrity = await prisma.celebrity.create({
      data: {
        name, phone, email,
        instagram, instagramFollowers,
        tiktok, tiktokFollowers,
        facebook, facebookFollowers,
        totalReach, proposedHandle, proposedPrice,
        renewalFee, notes, introducedBy, referralId,
      },
    });

    res.status(201).json({ message: 'Celebrity added', celebrity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllCelebrities = async (req, res) => {
  try {
    const celebrities = await prisma.celebrity.findMany({
      orderBy: { createdAt: 'desc' },
      include: { handles: true },
    });
    res.json({ celebrities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCelebrity = async (req, res) => {
  try {
    const { id } = req.params;
    const celebrity = await prisma.celebrity.findUnique({
      where: { id },
      include: { handles: true },
    });
    if (!celebrity) return res.status(404).json({ error: 'Celebrity not found' });
    res.json({ celebrity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateCelebrity = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const celebrity = await prisma.celebrity.update({
      where: { id },
      data: {
        ...data,
        dealClosedAt: data.status === 'CLOSED' ? new Date() : undefined,
      },
    });

    res.json({ message: 'Celebrity updated', celebrity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createCelebrityHandle = async (req, res) => {
  try {
    const { celebrityId } = req.params;
    const { handleName, purchasePrice, renewalFee } = req.body;

    if (!handleName) return res.status(400).json({ error: 'handleName is required' });

    const handle = await prisma.celebrityHandle.create({
      data: {
        celebrityId,
        handleName: handleName.toLowerCase(),
        purchasePrice,
        renewalFee,
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    res.status(201).json({ message: 'Celebrity handle reserved', handle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};