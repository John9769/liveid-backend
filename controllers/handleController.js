const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Load pricing from DB
async function getPricing() {
  const configs = await prisma.pricingConfig.findMany();
  const map = {};
  configs.forEach(c => map[c.key] = c.value);
  return map;
}

function getNumberMultiplier(numberSuffix) {
  if (!numberSuffix) return 1.0;
  const digits = numberSuffix;

  if (/^4+$/.test(digits)) return 0.7;
  if (digits.length >= 3 && /^(\d)\1+$/.test(digits)) return 2.0;

  const isSequential = (str) => {
    const chars = str.split('').map(Number);
    let ascending = true, descending = true;
    for (let i = 1; i < chars.length; i++) {
      if (chars[i] !== chars[i - 1] + 1) ascending = false;
      if (chars[i] !== chars[i - 1] - 1) descending = false;
    }
    return ascending || descending;
  };
  if (digits.length >= 3 && isSequential(digits)) return 1.5;

  const isMirrored = (str) => str === str.split('').reverse().join('');
  if (digits.length >= 4 && isMirrored(digits)) return 1.4;

  if (digits.length === 2 && /^(\d)\1$/.test(digits)) return 1.2;
  if (/^[1-9]0{2,}$/.test(digits)) return 1.15;

  return 1.0;
}

function parseHandleInput(input) {
  const match = input.match(/^([a-zA-Z_]+)(\d*)$/);
  if (!match) return null;
  return { baseWord: match[1].toLowerCase(), numberSuffix: match[2] || null };
}

async function calculatePricing(handleName) {
  const parsed = parseHandleInput(handleName);
  if (!parsed) return null;

  const { baseWord, numberSuffix } = parsed;
  const pricing = await getPricing();
  const STANDARD_BASE = pricing.STANDARD_HANDLE_BASE || 10;

  const curated = await prisma.curatedWord.findUnique({ where: { word: baseWord } });

  const tier = curated ? curated.tier : 'STANDARD';
  const basePrice = curated ? curated.basePrice : STANDARD_BASE;

  const multiplier = getNumberMultiplier(numberSuffix);
  const finalPrice = Math.round(basePrice * multiplier);

  return { baseWord, numberSuffix, tier, price: finalPrice };
}

exports.calculatePricing = calculatePricing;

exports.searchHandle = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'query is required' });

    const cleanQuery = query.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanQuery) return res.status(400).json({ error: 'Invalid handle name' });

    const pricing = await calculatePricing(cleanQuery);
    if (!pricing) return res.status(400).json({ error: 'Invalid handle format' });

    const existing = await prisma.handle.findUnique({ where: { name: cleanQuery } });
    const exactAvailable = !existing || existing.status !== 'ACTIVE';

    // Check if this is a vault word
    const isVaultWord = await prisma.vaultHandle.findUnique({ where: { name: cleanQuery } });
    if (isVaultWord) {
      return res.json({
        exact: { name: cleanQuery, available: false, isVault: true },
        variants: [],
        vaultRedirect: `/vault/${cleanQuery}`,
      });
    }

    // Expanded variants — 8 suggestions
    const variantSuffixes = [
      '88', '888', '8888',
      '99', '999',
      '123', '1234',
      new Date().getFullYear().toString(), // e.g. 2026
    ];

    const variants = [];
    for (const suffix of variantSuffixes) {
      const variantName = `${cleanQuery}${suffix}`;
      const variantPricing = await calculatePricing(variantName);
      const variantExisting = await prisma.handle.findUnique({ where: { name: variantName } });
      const variantAvailable = !variantExisting || variantExisting.status !== 'ACTIVE';
      const isVaultVariant = await prisma.vaultHandle.findUnique({ where: { name: variantName } });

      if (variantAvailable && variantPricing && !isVaultVariant) {
        variants.push({ name: variantName, ...variantPricing, available: true });
      }
    }

    res.json({
      exact: { name: cleanQuery, ...pricing, available: exactAvailable },
      variants,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.purchaseHandle = async (req, res) => {
  try {
    const { userId, handleName } = req.body;

    if (!userId || !handleName) {
      return res.status(400).json({ error: 'userId and handleName are required' });
    }

    const cleanName = handleName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    const existing = await prisma.handle.findUnique({ where: { name: cleanName } });
    if (existing && existing.status === 'ACTIVE') {
      return res.status(409).json({ error: 'This handle is already taken' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { activeHandle: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.activeHandle) {
      await prisma.handle.update({
        where: { id: user.activeHandle.id },
        data: { status: 'RETIRED', retiredAt: new Date(), ownerId: null },
      });
    }

    const pricingResult = await calculatePricing(cleanName);
    if (!pricingResult) return res.status(400).json({ error: 'Invalid handle format' });

    let handle;
    if (existing) {
      handle = await prisma.handle.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', ownerId: userId },
      });
    } else {
      handle = await prisma.handle.create({
        data: {
          name: cleanName,
          baseWord: pricingResult.baseWord,
          numberSuffix: pricingResult.numberSuffix,
          tier: pricingResult.tier,
          price: pricingResult.price,
          status: 'ACTIVE',
          ownerId: userId,
        },
      });
    }

    res.json({
      message: user.activeHandle ? 'Handle swapped successfully' : 'Handle purchased successfully',
      handle,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMyHandle = async (req, res) => {
  try {
    const { userId } = req.params;
    const handle = await prisma.handle.findUnique({ where: { ownerId: userId } });
    res.json({ handle: handle || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.verifyHandle = async (req, res) => {
  try {
    const { handleName } = req.params;
    const handle = await prisma.handle.findUnique({
      where: { name: handleName.toLowerCase() },
      include: {
        owner: {
          include: {
            profile: true,
            trustScore: true,
          },
        },
      },
    });

    if (!handle || handle.status !== 'ACTIVE' || !handle.owner) {
      return res.json({
        verified: false,
        message: 'This handle is no longer active or verified.',
      });
    }

    const user = handle.owner;
    const profile = user.profile;

    const isExpired = user.registrationExpiry && new Date() > new Date(user.registrationExpiry);
    if (isExpired) {
      return res.json({
        verified: false,
        expired: true,
        message: 'This LiveID handle has expired. The owner has not renewed their verification.',
      });
    }

    res.json({
      verified: true,
      handle: handle.name,
      tier: user.tier,
      genericId: user.genericId,
      verifiedAt: user.verifiedAt,
      registrationExpiry: user.registrationExpiry,
      handleHash: handle.handleHash,
      trustScore: user.trustScore?.score || 0,
      profile: {
        displayName: profile?.displayName || null,
        bio: profile?.bio || null,
        photoUrl: profile?.photoUrl || null,
        city: profile?.city || null,
        profession: profile?.profession || null,
        instagram: profile?.instagram || null,
        tiktok: profile?.tiktok || null,
        facebook: profile?.facebook || null,
        twitter: profile?.twitter || null,
        youtube: profile?.youtube || null,
        whatsapp: profile?.whatsapp || null,
        website: profile?.website || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getBillboard = async (req, res) => {
  try {
    const words = await prisma.curatedWord.findMany({ 
  where: { isVault: false },
  orderBy: { basePrice: 'desc' } 
});

    const billboard = [];
    for (const w of words) {
      const existing = await prisma.handle.findUnique({ where: { name: w.word } });
      const available = !existing || existing.status !== 'ACTIVE';
      if (available) {
        billboard.push({ name: w.word, tier: w.tier, price: w.basePrice });
      }
    }

    res.json({ billboard });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addCuratedWord = async (req, res) => {
  try {
    const { word, tier, basePrice } = req.body;
    if (!word || !tier || !basePrice) {
      return res.status(400).json({ error: 'word, tier, and basePrice are required' });
    }

    const curated = await prisma.curatedWord.create({
      data: { word: word.toLowerCase(), tier, basePrice },
    });

    res.status(201).json({ message: 'Curated word added', curated });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'This word already exists' });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.listCuratedWords = async (req, res) => {
  try {
    const words = await prisma.curatedWord.findMany({ orderBy: { basePrice: 'desc' } });
    res.json({ words });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.removeCuratedWord = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.curatedWord.delete({ where: { id } });
    res.json({ message: 'Curated word removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};