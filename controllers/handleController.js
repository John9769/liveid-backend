const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

// ============================================================
// PRICING HELPERS
// ============================================================

async function getPricing() {
  const configs = await prisma.pricingConfig.findMany();
  const map = {};
  configs.forEach((c) => (map[c.key] = c.value));
  return map;
}

function generateHandleHash(userId, handleName, faceId, createdAt) {
  const salt = process.env.HANDLE_HASH_SALT || 'liveid_default_salt';
  const payload = `${userId}|${handleName}|${faceId}|${createdAt}|${salt}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

const RENEWAL_KEY_BY_TIER = {
  STANDARD: 'ANNUAL_RENEWAL',
  SPECIAL: 'RENEWAL_SPECIAL',
  SILVER: 'RENEWAL_SILVER',
  GOLDEN: 'RENEWAL_GOLDEN',
};

const TIER_RANK = { STANDARD: 0, SPECIAL: 1, SILVER: 2, GOLDEN: 3, TITLE: 4 };

function getRenewalAmount(tier, pricing) {
  const key = RENEWAL_KEY_BY_TIER[tier] || 'ANNUAL_RENEWAL';
  return pricing[key] || pricing.ANNUAL_RENEWAL || 28;
}

function getNumberMultiplier(digits) {
  if (!digits) return 1.0;

  if (/^4+$/.test(digits)) return 0.7;
  if (digits.length >= 3 && /^(\d)\1+$/.test(digits)) return 2.0;

  const isSequential = (str) => {
    const chars = str.split('').map(Number);
    let ascending = true,
      descending = true;
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

// ============================================================
// PARSER
//
// Digits may appear anywhere — 88datuk, datuk88, big88boss.
// Letters are scanned for curated words; digits feed the
// multiplier. Position never changes the price.
// ============================================================

function parseHandleInput(input) {
  if (!input) return null;
  if (!/^[a-z0-9_]+$/.test(input)) return null;
  if (!/[a-z]/.test(input)) return null; // must contain letters

  const letters = input.replace(/[0-9]/g, '').replace(/_/g, '');
  const digits = input.replace(/[^0-9]/g, '');

  if (!letters) return null;

  return { letters, digits: digits || null };
}

// ============================================================
// CURATED MATCHING
//
// Scan the letters for every curated word anywhere in the
// string. Longest match wins. On a length tie, highest tier.
// ============================================================

async function findCuratedMatch(letters) {
  const words = await prisma.curatedWord.findMany({ where: { isActive: true } });

  let best = null;
  for (const w of words) {
    if (!letters.includes(w.word)) continue;
    if (!best) {
      best = w;
      continue;
    }
    if (w.word.length > best.word.length) {
      best = w;
    } else if (
      w.word.length === best.word.length &&
      TIER_RANK[w.tier] > TIER_RANK[best.tier]
    ) {
      best = w;
    }
  }
  return best;
}

// ============================================================
// CALCULATE PRICING
//
// Returns:
//   { blocked: true, category, title }  — title, needs a request
//   { baseWord, numberSuffix, tier, price, renewalAmount }
// ============================================================

async function calculatePricing(handleName) {
  const parsed = parseHandleInput(handleName);
  if (!parsed) return null;

  const { letters, digits } = parsed;
  const pricing = await getPricing();
  const STANDARD_BASE = pricing.STANDARD_HANDLE_BASE || 10;
  const ADDON = pricing.CURATED_ADDON || 40;

  // A blocked title anywhere in the letters kills the handle.
  const blockedWords = await prisma.blockedWord.findMany();
  const titleHit = blockedWords.find(
    (b) => b.category === 'TITLE' && letters.includes(b.word)
  );
  if (titleHit) {
    return {
      blocked: true,
      category: 'TITLE',
      title: titleHit.word,
      reason: titleHit.reason,
    };
  }

  // A real name that contains a curated word prices at STANDARD.
  const realNameHit = blockedWords.find(
    (b) => b.category === 'REAL_NAME' && letters.includes(b.word)
  );

  const multiplier = getNumberMultiplier(digits);

  if (realNameHit) {
    return {
      baseWord: letters,
      numberSuffix: digits,
      tier: 'STANDARD',
      price: Math.round(STANDARD_BASE * multiplier),
      renewalAmount: getRenewalAmount('STANDARD', pricing),
      matchedWord: null,
    };
  }

  const curated = await findCuratedMatch(letters);

  const tier = curated ? curated.tier : 'STANDARD';
  const basePrice = curated ? curated.basePrice + ADDON : STANDARD_BASE;
  const finalPrice = Math.round(basePrice * multiplier);

  return {
    baseWord: letters,
    numberSuffix: digits,
    tier,
    price: finalPrice,
    renewalAmount: getRenewalAmount(tier, pricing),
    matchedWord: curated ? curated.word : null,
  };
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

    // Title — not for sale, request only
    if (pricing.blocked) {
      const titlePrice = await prisma.titlePrice.findUnique({
        where: { title: pricing.title },
      });

      await prisma.searchLog.create({
        data: {
          query: cleanQuery,
          matchedWord: pricing.title,
          tier: 'TITLE',
          price: titlePrice?.price ?? null,
          available: false,
          blocked: true,
        },
      }).catch(() => {});

      return res.json({
        blocked: true,
        category: 'TITLE',
        title: pricing.title,
        titleLabel: titlePrice?.label || pricing.title,
        titlePrice: titlePrice?.price ?? null,
        message: 'This handle contains a conferred title. It requires verification before it can be issued.',
        requestUrl: `/title-request?handle=${cleanQuery}`,
        exact: null,
        variants: [],
        results: [],
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

    await prisma.searchLog.create({
      data: {
        query: cleanQuery,
        matchedWord: pricing.matchedWord,
        tier: pricing.tier,
        price: pricing.price,
        available: exactAvailable,
        blocked: false,
      },
    }).catch(() => {});

    // Variants are only offered on a clean word. If the query already
    // carries digits, that IS the user's choice — appending more
    // produces a meaningless number with no multiplier.
    if (pricing.numberSuffix) {
      return res.json({ exact, variants: [], results: [exact] });
    }

    // Variant suggestions
    const variantSuffixes = [
      '88',
      '888',
      '8888',
      '99',
      '999',
      '123',
      '1234',
      new Date().getFullYear().toString(),
    ];

    const variants = [];
    for (const suffix of variantSuffixes) {
      const variantName = `${cleanQuery}${suffix}`;
      const variantPricing = await calculatePricing(variantName);
      if (!variantPricing || variantPricing.blocked) continue;

      const variantExisting = await prisma.handle.findUnique({
        where: { name: variantName },
      });
      const variantAvailable =
        !variantExisting || variantExisting.status !== 'ACTIVE';

      if (variantAvailable) {
        variants.push({
          name: variantName,
          handle: variantName,
          ...variantPricing,
          available: true,
        });
      }
    }

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

    const pricingResult = await calculatePricing(cleanName);
    if (!pricingResult) return res.status(400).json({ error: 'Invalid handle format' });

    if (pricingResult.blocked) {
      return res.status(403).json({
        error: 'This handle contains a conferred title and requires verification.',
        title: pricingResult.title,
        requestUrl: `/title-request?handle=${cleanName}`,
      });
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

      // Renewal follows the new handle's tier.
      await tx.user.update({
        where: { id: user.id },
        data: {
          renewalAmount: pricingResult.renewalAmount,
          tier: pricingResult.tier === 'STANDARD' ? 'STANDARD' : 'PREMIUM_VARIANT',
        },
      });

      if (existing) {
        return tx.handle.update({
          where: { id: existing.id },
          data: {
            baseWord: pricingResult.baseWord,
            numberSuffix: pricingResult.numberSuffix,
            tier: pricingResult.tier,
            price: pricingResult.price,
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

    const isExpired =
      user.registrationExpiry && new Date() > new Date(user.registrationExpiry);
    if (isExpired) {
      return res.json({
        verified: false,
        expired: true,
        message:
          'This LiveID handle has expired. The owner has not renewed their verification.',
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
      isTitle: handle.isTitle,
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
//
// Clean curated words are never sold. The billboard shows the
// word and what a variant costs, to drive the search.
// ============================================================

exports.getBillboard = async (req, res) => {
  try {
    const pricing = await getPricing();
    const ADDON = pricing.CURATED_ADDON || 40;

    const words = await prisma.curatedWord.findMany({
      where: { isActive: true },
      orderBy: { basePrice: 'desc' },
    });

    const billboard = words.map((w) => ({
      name: w.word,
      tier: w.tier,
      variantPrice: w.basePrice + ADDON,
      example: `${w.word}yourname`,
    }));

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

    const validTiers = ['SPECIAL', 'SILVER', 'GOLDEN'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: `tier must be one of: ${validTiers.join(', ')}` });
    }

    const cleanWord = word.trim().toLowerCase().replace(/[^a-z_]/g, '');
    if (!cleanWord) return res.status(400).json({ error: 'Invalid word' });

    if (cleanWord.length < 4) {
      return res.status(400).json({
        error: 'Curated words must be at least 4 letters — shorter words collide with real names',
      });
    }

    const blocked = await prisma.blockedWord.findUnique({ where: { word: cleanWord } });
    if (blocked) {
      return res.status(409).json({ error: `This word is blocked (${blocked.category})` });
    }

    const price = parseFloat(basePrice);
    if (isNaN(price) || price < 0) return res.status(400).json({ error: 'Invalid basePrice' });

    const curated = await prisma.curatedWord.create({
      data: { word: cleanWord, tier, basePrice: price, isActive: true },
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
    const pricing = await getPricing();
    const ADDON = pricing.CURATED_ADDON || 40;

    const words = await prisma.curatedWord.findMany({ orderBy: { basePrice: 'desc' } });
    const enriched = words.map((w) => ({ ...w, variantPrice: w.basePrice + ADDON }));

    res.json({ words: enriched });
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

// ============================================================
// BLOCKED WORDS (admin)
// ============================================================

exports.listBlockedWords = async (req, res) => {
  try {
    const { category } = req.query;
    const where = category ? { category } : {};
    const words = await prisma.blockedWord.findMany({
      where,
      orderBy: { word: 'asc' },
    });
    res.json({ words });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addBlockedWord = async (req, res) => {
  try {
    const { word, category, reason } = req.body;
    if (!word || !category) {
      return res.status(400).json({ error: 'word and category are required' });
    }

    const validCategories = ['TITLE', 'REAL_NAME'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${validCategories.join(', ')}` });
    }

    const cleanWord = word.trim().toLowerCase().replace(/[^a-z_']/g, '');
    if (!cleanWord) return res.status(400).json({ error: 'Invalid word' });

    const blocked = await prisma.blockedWord.create({
      data: { word: cleanWord, category, reason: reason || null },
    });

    res.status(201).json({ message: 'Blocked word added', blocked });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'This word is already blocked' });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.removeBlockedWord = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.blockedWord.delete({ where: { id } });
    res.json({ message: 'Blocked word removed' });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Blocked word not found' });
    }
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// SEARCH LOG (admin)
//
// What people actually type. Use this to find the words you
// haven't curated yet.
// ============================================================

exports.getSearchLog = async (req, res) => {
  try {
    const { limit } = req.query;
    const take = Math.min(parseInt(limit) || 200, 1000);

    const logs = await prisma.searchLog.findMany({
      orderBy: { createdAt: 'desc' },
      take,
    });

    const counts = await prisma.searchLog.groupBy({
      by: ['query'],
      _count: { query: true },
      orderBy: { _count: { query: 'desc' } },
      take: 50,
    });

    const top = counts.map((c) => ({ query: c.query, count: c._count.query }));

    res.json({ logs, top });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};