const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const { normalizePhone, phonesMatch, formatPhoneDisplay } = require('../utils/phone');
const prisma = new PrismaClient();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// How many number checks one IP may make against one handle per day.
// Two is a mistype allowance and nothing more — it makes discovering
// a hidden number by elimination impossible.
const MATCH_LIMIT_PER_DAY = 2;

// ============================================================
// Reads the bearer token if one is present. Never throws —
// the verification page is public and must render for anyone.
// Returns the viewer's userId, or null for an anonymous visitor.
// ============================================================

function readViewer(req) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return null;

    const token = authHeader.split(' ')[1];
    if (!token || !process.env.JWT_SECRET) return null;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.isAdmin) return null;
    return decoded.userId || null;
  } catch {
    return null;
  }
}

function readIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

// ============================================================
// PAGE COMPLETENESS
//
// What a visitor can actually check on this page. A handle with
// no social accounts and no contact is verified but unusable as
// proof — the owner needs to know that.
//
//   verified human   40
//   face photo       20   (counts even when members-only)
//   social accounts  30   (one or more)
//   whatsapp         10
// ============================================================

function computeCompleteness(profile) {
  const hasSocial = !!(
    profile?.instagram ||
    profile?.tiktok ||
    profile?.facebook ||
    profile?.twitter ||
    profile?.youtube ||
    profile?.website
  );
  const hasPhoto = !!profile?.photoUrl;
  const hasWhatsapp = !!profile?.whatsappE164;

  const score = 40 + (hasPhoto ? 20 : 0) + (hasSocial ? 30 : 0) + (hasWhatsapp ? 10 : 0);

  return {
    score,
    verified: true,
    hasPhoto,
    hasSocial,
    hasWhatsapp,
  };
}

exports.getProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      include: {
        user: {
          include: { activeHandle: true },
        },
      },
    });

    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    // Shop items for the editor to load
    const shopItems = await prisma.shopItem.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const { user, ...rest } = profile;
    const safeUser = user
      ? {
          id: user.id,
          genericId: user.genericId,
          email: user.email,
          phone: user.phone,
          tier: user.tier,
          isVerified: user.isVerified,
          registrationExpiry: user.registrationExpiry,
          activeHandle: user.activeHandle || null,
        }
      : null;

    res.json({
      profile: { ...rest, user: safeUser, shopItems },
      completeness: computeCompleteness(profile),
    });
  } catch (err) {
    console.error('getProfile error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.upsertProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      displayName, bio, city, profession,
      instagram, tiktok, facebook, twitter,
      youtube, whatsapp, website,
      whatsappMode,
      photoPublic,
      shopActive, shopTitle, shopArea, shopAbout,
    } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // The number is stored twice on purpose:
    //   whatsapp      — exactly what the owner typed, echoed back to their form
    //   whatsappE164  — the machine copy, the only thing ever compared
    // Written together so they can never drift apart.
    const rawWhatsapp = whatsapp ?? null;
    const e164 = normalizePhone(rawWhatsapp);

    if (rawWhatsapp && !e164) {
      return res.status(400).json({
        error: 'That does not look like a Malaysian mobile number. Use 012-3456789 or +60 12-345 6789.',
      });
    }

    const validModes = ['HIDDEN', 'MATCH_ONLY', 'PUBLIC'];
    const mode = validModes.includes(whatsappMode) ? whatsappMode : 'MATCH_ONLY';

    // Explicit whitelist — photoUrl is never accepted from the client.
    // The selfie is captured at registration and cannot be swapped.
    const data = {
      displayName: displayName ?? null,
      bio: bio ?? null,
      city: city ?? null,
      profession: profession ?? null,
      instagram: instagram ?? null,
      tiktok: tiktok ?? null,
      facebook: facebook ?? null,
      twitter: twitter ?? null,
      youtube: youtube ?? null,
      whatsapp: rawWhatsapp,
      whatsappE164: e164,
      whatsappMode: mode,
      website: website ?? null,
      // The member decides whether their verified photo is shown to
      // anonymous visitors. Private is the default.
      photoPublic: photoPublic === true,

      // Shop — the seller's mini storefront on their verification page
      shopActive: shopActive === true,
      shopTitle: shopTitle ?? null,
      shopArea: shopArea ?? null,
      shopAbout: shopAbout ?? null,
    };

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });

    const completeness = computeCompleteness(profile);

    await prisma.trustScore.upsert({
      where: { userId },
      update: {
        score: completeness.score,
        factors: completeness,
        calculatedAt: new Date(),
      },
      create: {
        userId,
        score: completeness.score,
        factors: completeness,
      },
    });

    res.json({ message: 'Profile updated', profile, completeness });
  } catch (err) {
    console.error('upsertProfile error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.uploadPhoto = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo is required' });

    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'liveid_selfies',
          public_id: `profile_${userId}`,
          overwrite: true,
          transformation: [
            { width: 400, height: 400, crop: 'fill', gravity: 'face' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    await prisma.userProfile.upsert({
      where: { userId },
      update: { photoUrl: result.secure_url },
      create: { userId, photoUrl: result.secure_url },
    });

    res.json({ message: 'Photo uploaded', photoUrl: result.secure_url });
  } catch (err) {
    console.error('uploadPhoto error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// PUBLIC VERIFICATION PAGE — the product
//
// The page answers one question: is the person you are dealing
// with the owner of this handle? It is a comparison tool, not a
// certificate. Everything below is shaped for that.
//
// PHOTO — released to anonymous only if the owner chose public.
// Otherwise members only. The face is the strongest identifying
// data on the page; releasing it to everyone would make every
// handle a harvestable photo directory.
//
// WHATSAPP — the owner picks one of three:
//   PUBLIC      the number is shown on the page
//   MATCH_ONLY  the number is never sent anywhere. A visitor can
//               test a number they were given against it and gets
//               back yes or no. Nothing is disclosed.
//   HIDDEN      no number, no check.
//
// The number is never returned unless the mode is PUBLIC. Not to
// members either — MATCH_ONLY means match only.
// ============================================================

exports.getPublicProfile = async (req, res) => {
  try {
    const { handleName } = req.params;
    const cleanName = handleName.toLowerCase();

    const viewerId = readViewer(req);
    const ip = readIp(req);

    // Log the visit — fire and forget, never block verification
    prisma.verifyLog.create({
      data: {
        handleName: cleanName,
        viewerId,
        ip,
        userAgent: req.headers['user-agent'] || null,
        referer: req.headers['referer'] || null,
      },
    }).catch(() => {});

    const handle = await prisma.handle.findUnique({
      where: { name: cleanName },
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
      return res.status(404).json({
        verified: false,
        handle: cleanName,
        message: 'This handle is no longer active or verified',
      });
    }

    const user = handle.owner;

    if (user.registrationExpiry && new Date() > new Date(user.registrationExpiry)) {
      return res.json({
        verified: false,
        expired: true,
        handle: handle.name,
        message: 'This handle has expired. The owner has not renewed their LiveID.',
      });
    }

    const referral = await prisma.referral.findFirst({
      where: { email: user.email, isActiveReferral: true, isActive: true },
      select: { code: true },
    });

    const p = user.profile;
    const isMember = !!viewerId;

    // Shop — only if the seller switched it on. Available items only;
    // sold/unavailable ones are hidden from the buyer.
    let shop = null;
    if (p?.shopActive) {
      const items = await prisma.shopItem.findMany({
        where: { userId: user.id, isAvailable: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, price: true, detail: true, hasImages: true },
      });
      shop = {
        title: p.shopTitle || null,
        area: p.shopArea || null,
        about: p.shopAbout || null,
        items,
      };
    }

    const mode = p?.whatsappMode || 'MATCH_ONLY';
    const hasWhatsapp = !!p?.whatsappE164;

    // The number leaves the server only on PUBLIC. On MATCH_ONLY the
    // page gets a flag telling it to offer the check instead.
    const whatsappPublic = mode === 'PUBLIC' && hasWhatsapp
      ? formatPhoneDisplay(p.whatsappE164)
      : null;
    const whatsappCheckAvailable = mode === 'MATCH_ONLY' && hasWhatsapp;

    const hasSocial = !!(
      p?.instagram || p?.tiktok || p?.facebook ||
      p?.twitter || p?.youtube || p?.website
    );

    // How many checks the page can offer, so the verdict block can say
    // "both match" or "all three match" without ever counting a check
    // that was never shown.
    const checksAvailable =
      1 + // face — always a check, even when locked
      (hasSocial ? 1 : 0) +
      (whatsappPublic || whatsappCheckAvailable ? 1 : 0);

    res.json({
      verified: true,
      handle: handle.name,
      tier: user.tier,
      genericId: user.genericId,
      verifiedAt: user.verifiedAt,
      registrationExpiry: user.registrationExpiry,
      handleHash: handle.handleHash || null,
      isTitle: handle.isTitle,
      trustScore: user.trustScore?.score || 0,

      // The member chooses. Public photos show to everyone. Private
      // photos show only to logged-in LiveID members.
      photoUrl: (p?.photoPublic || isMember) ? (p?.photoUrl || null) : null,
      photoLocked: !isMember && !p?.photoPublic && !!p?.photoUrl,
      viewerIsMember: isMember,

      displayName: p?.displayName || null,
      bio: p?.bio || null,
      city: p?.city || null,
      profession: p?.profession || null,
      instagram: p?.instagram || null,
      tiktok: p?.tiktok || null,
      facebook: p?.facebook || null,
      twitter: p?.twitter || null,
      youtube: p?.youtube || null,
      website: p?.website || null,

      // Never the raw number unless the owner made it public.
      whatsapp: whatsappPublic,
      whatsappCheckAvailable,

      hasSocial,
      checksAvailable,

      isReferral: !!referral,
      referralCode: referral?.code || null,

      shop,
    });
  } catch (err) {
    console.error('getPublicProfile error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// NUMBER MATCH CHECK
//
// The visitor already has a number — someone gave it to them.
// They ask one question about one handle: does this number
// belong to it? The answer is yes or no.
//
// What this deliberately never does:
//   - take a number without a handle
//   - say who a number belongs to
//   - say anything at all about a number that is not the one asked
//
// Number in, boolean out. Nothing the caller did not already
// know can leave this endpoint, so it discloses nothing.
//
// Two attempts per handle per IP per day. That is enough for a
// mistype and far too few to discover a hidden number by
// elimination.
// ============================================================

exports.checkWhatsapp = async (req, res) => {
  try {
    const { handleName } = req.params;
    const { number } = req.body;

    const cleanName = String(handleName || '').toLowerCase();
    if (!cleanName) return res.status(400).json({ error: 'Handle is required' });
    if (!number) return res.status(400).json({ error: 'Number is required' });

    const candidate = normalizePhone(number);
    if (!candidate) {
      // A malformed number is not an attempt — nothing was tested,
      // so it must not consume the allowance.
      return res.status(400).json({
        error: 'invalid_number',
        message: 'That does not look like a Malaysian mobile number.',
      });
    }

    const viewerId = readViewer(req);
    const ip = readIp(req);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const used = await prisma.matchAttempt.count({
      where: { handleName: cleanName, ip, createdAt: { gte: since } },
    });

    if (used >= MATCH_LIMIT_PER_DAY) {
      return res.status(429).json({
        error: 'rate_limited',
        message: 'You have used all your checks for this handle today. Try again in 24 hours.',
        remaining: 0,
      });
    }

    const handle = await prisma.handle.findUnique({
      where: { name: cleanName },
      include: { owner: { include: { profile: true } } },
    });

    const p = handle?.owner?.profile;
    const active = handle && handle.status === 'ACTIVE' && handle.owner;
    const expired =
      handle?.owner?.registrationExpiry &&
      new Date() > new Date(handle.owner.registrationExpiry);

    // A handle with no number on file, or a mode that does not offer
    // the check, cannot answer. Say so plainly — do not return false,
    // which would read as "that number is wrong".
    if (!active || expired || !p?.whatsappE164 || p.whatsappMode === 'HIDDEN') {
      return res.status(404).json({
        error: 'not_available',
        message: 'This handle has no registered WhatsApp number to check against.',
      });
    }

    const matched = phonesMatch(candidate, p.whatsappE164);

    // Logged after the comparison, before the response. Failed checks
    // against one handle are the earliest signal that someone is being
    // impersonated right now.
    await prisma.matchAttempt.create({
      data: { handleName: cleanName, ip, viewerId, matched },
    }).catch(() => {});

    res.json({
      matched,
      remaining: Math.max(0, MATCH_LIMIT_PER_DAY - (used + 1)),
    });
  } catch (err) {
    console.error('checkWhatsapp error:', err.message);
    res.status(500).json({ error: err.message });
  }
};