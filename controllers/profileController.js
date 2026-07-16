const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const prisma = new PrismaClient();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

    res.json({ profile: { ...rest, user: safeUser } });
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
    } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

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
      whatsapp: whatsapp ?? null,
      website: website ?? null,
    };

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });

    const fields = [
      displayName, bio, city, profession,
      instagram, tiktok, facebook, twitter,
      youtube, whatsapp, website,
    ];
    const filledFields = fields.filter((f) => f && String(f).trim() !== '').length;
    const profileComplete = filledFields >= 3;

    const baseScore = 50;
    const score = baseScore + (profileComplete ? 10 : 0);

    await prisma.trustScore.upsert({
      where: { userId },
      update: {
        score,
        factors: { verified: true, renewal: false, profileComplete },
        calculatedAt: new Date(),
      },
      create: {
        userId,
        score,
        factors: { verified: true, renewal: false, profileComplete },
      },
    });

    res.json({ message: 'Profile updated', profile });
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
// Everything is visible to everyone EXCEPT the verified selfie.
// The photo is released only to a logged-in LiveID member.
//
// Reason: the face is the strongest identifying data on the page.
// Releasing it to anonymous visitors makes every handle a
// harvestable photo directory. A member checking another member
// is accountable — the view is recorded.
//
// This is disclosed in the Privacy Policy and stated on the page.
// ============================================================

exports.getPublicProfile = async (req, res) => {
  try {
    const { handleName } = req.params;
    const cleanName = handleName.toLowerCase();

    const viewerId = readViewer(req);

    // Log the visit — fire and forget, never block verification
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
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

    res.json({
      verified: true,
      handle: handle.name,
      tier: user.tier,
      genericId: user.genericId,
      verifiedAt: user.verifiedAt,
      registrationExpiry: user.registrationExpiry,
      handleHash: handle.handleHash || null,
      trustScore: user.trustScore?.score || 0,

      // The photo is the gated field. Everything else is public.
      photoUrl: isMember ? (p?.photoUrl || null) : null,
      photoLocked: !isMember && !!p?.photoUrl,
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
      whatsapp: p?.whatsapp || null,
      website: p?.website || null,

      isReferral: !!referral,
      referralCode: referral?.code || null,
    });
  } catch (err) {
    console.error('getPublicProfile error:', err.message);
    res.status(500).json({ error: err.message });
  }
};