const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const VALID_CELEBRITY_STATUS = ['PROSPECT', 'CONTACTED', 'NEGOTIATING', 'CLOSED', 'DECLINED'];
const VALID_HANDLE_STATUS = ['RESERVED', 'ACTIVE', 'EXPIRED'];

// ============================================================
// CREATE CELEBRITY
// ============================================================

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

    if (referralId) {
      const referral = await prisma.referral.findUnique({ where: { id: referralId } });
      if (!referral) return res.status(404).json({ error: 'Referral not found' });
    }

    const cleanHandle = proposedHandle
      ? proposedHandle.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
      : null;

    const celebrity = await prisma.celebrity.create({
      data: {
        name,
        phone: phone || null,
        email: email || null,
        instagram: instagram || null,
        instagramFollowers: instagramFollowers ? parseInt(instagramFollowers) : null,
        tiktok: tiktok || null,
        tiktokFollowers: tiktokFollowers ? parseInt(tiktokFollowers) : null,
        facebook: facebook || null,
        facebookFollowers: facebookFollowers ? parseInt(facebookFollowers) : null,
        totalReach: totalReach ? parseInt(totalReach) : null,
        proposedHandle: cleanHandle,
        proposedPrice: proposedPrice ? parseFloat(proposedPrice) : null,
        renewalFee: renewalFee ? parseFloat(renewalFee) : null,
        notes: notes || null,
        introducedBy: introducedBy || null,
        referralId: referralId || null,
      },
    });

    res.status(201).json({ message: 'Celebrity added', celebrity });
  } catch (err) {
    console.error('createCelebrity error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// GET ALL CELEBRITIES
// ============================================================

exports.getAllCelebrities = async (req, res) => {
  try {
    const { status } = req.query;

    if (status && !VALID_CELEBRITY_STATUS.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_CELEBRITY_STATUS.join(', ')}` });
    }

    const celebrities = await prisma.celebrity.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: { handles: true },
    });

    res.json({ celebrities });
  } catch (err) {
    console.error('getAllCelebrities error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// GET ONE CELEBRITY
// ============================================================

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
    console.error('getCelebrity error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// UPDATE CELEBRITY
// ============================================================

exports.updateCelebrity = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, phone, email,
      instagram, instagramFollowers,
      tiktok, tiktokFollowers,
      facebook, facebookFollowers,
      totalReach, proposedHandle, proposedPrice,
      renewalFee, status, notes,
      introducedBy, referralId, contractValue,
    } = req.body;

    const existing = await prisma.celebrity.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Celebrity not found' });

    if (status && !VALID_CELEBRITY_STATUS.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_CELEBRITY_STATUS.join(', ')}` });
    }

    if (referralId) {
      const referral = await prisma.referral.findUnique({ where: { id: referralId } });
      if (!referral) return res.status(404).json({ error: 'Referral not found' });
    }

    // Explicit whitelist — never spread raw req.body into Prisma
    const data = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone || null;
    if (email !== undefined) data.email = email || null;
    if (instagram !== undefined) data.instagram = instagram || null;
    if (instagramFollowers !== undefined) data.instagramFollowers = instagramFollowers ? parseInt(instagramFollowers) : null;
    if (tiktok !== undefined) data.tiktok = tiktok || null;
    if (tiktokFollowers !== undefined) data.tiktokFollowers = tiktokFollowers ? parseInt(tiktokFollowers) : null;
    if (facebook !== undefined) data.facebook = facebook || null;
    if (facebookFollowers !== undefined) data.facebookFollowers = facebookFollowers ? parseInt(facebookFollowers) : null;
    if (totalReach !== undefined) data.totalReach = totalReach ? parseInt(totalReach) : null;
    if (proposedHandle !== undefined) {
      data.proposedHandle = proposedHandle
        ? proposedHandle.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
        : null;
    }
    if (proposedPrice !== undefined) data.proposedPrice = proposedPrice ? parseFloat(proposedPrice) : null;
    if (renewalFee !== undefined) data.renewalFee = renewalFee ? parseFloat(renewalFee) : null;
    if (notes !== undefined) data.notes = notes || null;
    if (introducedBy !== undefined) data.introducedBy = introducedBy || null;
    if (referralId !== undefined) data.referralId = referralId || null;
    if (contractValue !== undefined) data.contractValue = contractValue ? parseFloat(contractValue) : null;
    if (status !== undefined) data.status = status;

    // Stamp the close date once, on the transition into CLOSED
    if (status === 'CLOSED' && existing.status !== 'CLOSED') {
      data.dealClosedAt = new Date();
    }

    const celebrity = await prisma.celebrity.update({ where: { id }, data });

    res.json({ message: 'Celebrity updated', celebrity });
  } catch (err) {
    console.error('updateCelebrity error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// CREATE CELEBRITY HANDLE (reserve a name for a prospect)
// ============================================================

exports.createCelebrityHandle = async (req, res) => {
  try {
    const { celebrityId } = req.params;
    const { handleName, purchasePrice, renewalFee } = req.body;

    if (!handleName) return res.status(400).json({ error: 'handleName is required' });

    const celebrity = await prisma.celebrity.findUnique({ where: { id: celebrityId } });
    if (!celebrity) return res.status(404).json({ error: 'Celebrity not found' });

    const cleanName = handleName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanName) return res.status(400).json({ error: 'Invalid handle name' });

    // Cannot reserve a name that a real user already holds
    const liveHandle = await prisma.handle.findUnique({ where: { name: cleanName } });
    if (liveHandle && liveHandle.status === 'ACTIVE') {
      return res.status(409).json({ error: 'This handle is already taken by a registered user' });
    }

    // Cannot reserve a title name — titles require documentary proof
    const letters = cleanName.replace(/[0-9]/g, '').replace(/_/g, '');
    const blockedTitles = await prisma.blockedWord.findMany({ where: { category: 'TITLE' } });
    const titleHit = blockedTitles.find((b) => letters.includes(b.word));
    if (titleHit) {
      return res.status(409).json({ error: `This handle contains the title "${titleHit.word}" and requires verification` });
    }

    // handleName is @unique on CelebrityHandle
    const existingReservation = await prisma.celebrityHandle.findUnique({
      where: { handleName: cleanName },
    });
    if (existingReservation) {
      return res.status(409).json({ error: 'This handle is already reserved for a celebrity' });
    }

    const handle = await prisma.celebrityHandle.create({
      data: {
        celebrityId,
        handleName: cleanName,
        purchasePrice: purchasePrice ? parseFloat(purchasePrice) : null,
        renewalFee: renewalFee ? parseFloat(renewalFee) : null,
        status: 'RESERVED',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    res.status(201).json({ message: 'Celebrity handle reserved', handle });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'This handle is already reserved' });
    }
    console.error('createCelebrityHandle error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// UPDATE CELEBRITY HANDLE
// ============================================================

exports.updateCelebrityHandle = async (req, res) => {
  try {
    const { handleId } = req.params;
    const { status, purchasePrice, renewalFee, expiresAt } = req.body;

    const existing = await prisma.celebrityHandle.findUnique({ where: { id: handleId } });
    if (!existing) return res.status(404).json({ error: 'Celebrity handle not found' });

    if (status && !VALID_HANDLE_STATUS.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_HANDLE_STATUS.join(', ')}` });
    }

    const data = {};
    if (purchasePrice !== undefined) data.purchasePrice = purchasePrice ? parseFloat(purchasePrice) : null;
    if (renewalFee !== undefined) data.renewalFee = renewalFee ? parseFloat(renewalFee) : null;
    if (expiresAt !== undefined) data.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (status !== undefined) data.status = status;

    if (status === 'ACTIVE' && existing.status !== 'ACTIVE') {
      data.activatedAt = new Date();
    }

    const handle = await prisma.celebrityHandle.update({ where: { id: handleId }, data });

    res.json({ message: 'Celebrity handle updated', handle });
  } catch (err) {
    console.error('updateCelebrityHandle error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// DELETE CELEBRITY HANDLE (release a reservation)
// ============================================================

exports.deleteCelebrityHandle = async (req, res) => {
  try {
    const { handleId } = req.params;

    const existing = await prisma.celebrityHandle.findUnique({ where: { id: handleId } });
    if (!existing) return res.status(404).json({ error: 'Celebrity handle not found' });

    if (existing.ownerId) {
      return res.status(400).json({ error: 'Cannot delete — this handle is owned by a registered user' });
    }

    await prisma.celebrityHandle.delete({ where: { id: handleId } });

    res.json({ message: 'Celebrity handle reservation released' });
  } catch (err) {
    console.error('deleteCelebrityHandle error:', err.message);
    res.status(500).json({ error: err.message });
  }
};