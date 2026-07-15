const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

// Load pricing from DB
async function getPricing() {
  const configs = await prisma.pricingConfig.findMany();
  const map = {};
  configs.forEach(c => map[c.key] = c.value);
  return map;
}

function generateHandleHash(userId, handleName, faceId, createdAt) {
  const salt = process.env.HANDLE_HASH_SALT || 'liveid_default_salt';
  const payload = `${userId}|${handleName}|${faceId}|${createdAt}|${salt}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
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

// ============================================================
// SEARCH HANDLE
// ============================================================

exports.searchHandle = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'query is required' });

    const cleanQuery = query.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanQuery) return res.status(400).json({ error: 'Invalid handle name' });

    const pricing = await calculatePricing(cleanQuery);
    if (!pricing) return res.status(400).json({ error: 'Invalid handle format' });

    // Vault words are sold through The Vault only
    const isVaultWord = await prisma.vaultHandle.findUnique({ where: { name: cleanQuery } });
    if (isVaultWord) {
      return res.json({
        exact: { name: cleanQuery, handle: cleanQuery, available: false, isVault: true },
        variants: [],
        results: [{ name: cleanQuery, handle: cleanQuery, available: false, isVault: true }],
        vaultRedirect: `/vault/${cleanQuery}`,
      });
    }

    const existing = await prisma.handle.findUnique({ where: { name: cleanQuery } });
    const exactAvailable = !existing || existing.status !== 'ACTIVE';

    const exact = {
      name: cleanQuery,
      handle: cleanQuery,
      ...pricing,
      available: exactAvailable,
    };

    // Variant suggestions
    const variantSuffixes = [
      '88', '888', '8888',
      '99', '999',
      '123', '1234',
      new Date().getFullYear().toString(),
    ];

    const variants = [];
    for (const suffix of variantSuffixes) {
      const variantName = `${cleanQuery}${suffix}`;
      const variantPricing = await calculatePricing(variantName);
      if (!variantPricing) continue;

      const variantExisting = await prisma.handle.findUnique({ where: { name: variantName } });
      const variantAvailable = !variantExisting || variantExisting.status !== 'ACTIVE';
      const isVaultVariant = await prisma.vaultHandle.findUnique({ where: { name: variantName } });

      if (variantAvailable && !isVaultVariant) {
        variants.push({
          name: variantName,
          handle: variantName,
          ...variantPricing,
          available: true,
        });
      }
    }

    // `results` = flat list for the FE register page. exact first, then variants.
    const results = [exact, ...variants];

    res.json({ exact, variants, results });
  } catch (err) {
    console.error('searchHandle error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// PURCHASE HANDLE (handle swap for existing users)
// ============================================================

exports.purchaseHandle = async (req, res) => {
  try {
    const { userId, handleName } = req.body;

    if (!userId || !handleName) {
      return res.status(400).json({ error: 'userId and handleName are required' });
    }

    const cleanName = handleName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanName) return res.status(400).json({ error: 'Invalid handle name' });

    // Vault names cannot be claimed through this route
    const isVault = await prisma.vaultHandle.findUnique({ where: { name: cleanName } });
    if (isVault) {
      return res.status(409).json({ error: 'This handle is only available through The Vault' });
    }

    const existing = await prisma.handle.findUnique({ where: { name: cleanName } });
    if (existing && existing.status === 'ACTIVE') {
      return res.status(409).json({ error: 'This handle is already taken' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { activeHandle: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const pricingResult = await calculatePricing(cleanName);
    if (!pricingResult) return res.status(400).json({ error: 'Invalid handle format' });

    const handleHash = generateHandleHash(
      user.id,
      cleanName,
      user.faceId,
      new Date().toISOString()
    );

    const hadHandle = !!user.activeHandle;

    // Retire old handle and claim the new one atomically —
    // Handle.ownerId is @unique, so both must happen or neither.
    const handle = await prisma.$transaction(async (tx) => {
      if (user.activeHandle) {
        await tx.handle.update({
          where: { id: user.activeHandle.id },
          data: { status: 'RETIRED', retiredAt: new Date(), ownerId: null },
        });
      }

      if (existing) {
        return tx.handle.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            ownerId: user.id,
            handleHash,
            retiredAt: null,
          },
        });
      }

      return tx.handle.create({
        data: {
          name: cleanName,
          baseWord: pricingResult.baseWord,
          numberSuffix: pricingResult.numberSuffix,
          tier: pricingResult.tier,
          price: pricingResult.price,
          status: 'ACTIVE',
          ownerId: user.id,
          handleHash,
        },
      });
    });

    res.json({
      message: hadHandle ? 'Handle swapped successfully' : 'Handle purchased successfully',
      handle,
    });
  } catch (err) {
    console.error('purchaseHandle error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// GET MY HANDLE
// ============================================================

exports.getMyHandle = async (req, res) => {
  try {
    const { userId } = req.params;
    const handle = await prisma.handle.findUnique({ where: { ownerId: userId } });
    res.json({ handle: handle || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// VERIFY HANDLE
// ============================================================

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

// ============================================================
// BILLBOARD
// ============================================================

exports.getBillboard = async (req, res) => {
  try {
    const words = await prisma.curatedWord.findMany({
      where: { isVault: false },
      orderBy: { basePrice: 'desc' },
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

// ============================================================
// CURATED WORDS (admin)
// ============================================================

exports.addCuratedWord = async (req, res) => {
  try {
    const { word, tier, basePrice } = req.body;
    if (!word || !tier || basePrice === undefined) {
      return res.status(400).json({ error: 'word, tier, and basePrice are required' });
    }

    const validTiers = ['STANDARD', 'SPECIAL', 'SILVER', 'GOLDEN'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: `tier must be one of: ${validTiers.join(', ')}` });
    }

    const cleanWord = word.trim().toLowerCase().replace(/[^a-z_]/g, '');
    if (!cleanWord) return res.status(400).json({ error: 'Invalid word' });

    const price = parseFloat(basePrice);
    if (isNaN(price) || price < 0) return res.status(400).json({ error: 'Invalid basePrice' });

    const curated = await prisma.curatedWord.create({
      data: { word: cleanWord, tier, basePrice: price },
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
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Curated word not found' });
    }
    res.status(500).json({ error: err.message });
  }
};