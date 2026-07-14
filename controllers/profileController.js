const { PrismaClient } = require('@prisma/client');
const cloudinary = require('cloudinary').v2;
const prisma = new PrismaClient();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

    res.json({ profile });
  } catch (err) {
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

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      update: {
        displayName, bio, city, profession,
        instagram, tiktok, facebook, twitter,
        youtube, whatsapp, website,
      },
      create: {
        userId,
        displayName, bio, city, profession,
        instagram, tiktok, facebook, twitter,
        youtube, whatsapp, website,
      },
    });

    // Update trust score — profile complete check
    const fields = [displayName, bio, city, profession, instagram, tiktok, facebook, twitter, youtube, whatsapp, website];
    const filledFields = fields.filter(f => f && f.trim() !== '').length;
    const profileComplete = filledFields >= 3;

    if (profileComplete) {
      await prisma.trustScore.upsert({
        where: { userId },
        update: {
          score: { increment: 10 },
          factors: { verified: true, renewal: false, profileComplete: true },
          calculatedAt: new Date(),
        },
        create: {
          userId,
          score: 60,
          factors: { verified: true, renewal: false, profileComplete: true },
        },
      });
    }

    res.json({ message: 'Profile updated', profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.uploadPhoto = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo is required' });

    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Upload to Cloudinary — square crop, face gravity, auto quality
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'liveid/profiles',
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

    // Update profile photoUrl
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

exports.getPublicProfile = async (req, res) => {
  try {
    const { handleName } = req.params;

    // Log this visit — fire and forget, never block the response
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
    prisma.verifyLog.create({
      data: {
        handleName: handleName.toLowerCase(),
        ip,
        userAgent: req.headers['user-agent'] || null,
        referer: req.headers['referer'] || null,
      },
    }).catch(() => {}); // silent fail — never break verify for logging

    const handle = await prisma.handle.findUnique({
      where: { name: handleName.toLowerCase() },
      include: {
        owner: {
          include: {
            profile: true,
            activeHandle: true,
            trustScore: true,
          },
        },
      },
    });

    if (!handle || handle.status !== 'ACTIVE' || !handle.owner) {
      return res.status(404).json({ verified: false, message: 'This handle is no longer active or verified' });
    }

    // Check if registration expired
    const user = handle.owner;
    if (user.registrationExpiry && new Date() > new Date(user.registrationExpiry)) {
      return res.json({
        verified: false,
        expired: true,
        message: 'This handle has expired. The owner has not renewed their LiveID.',
      });
    }

    // Check if handle owner is an active referral
    const referral = await prisma.referral.findFirst({
      where: { email: user.email, isActiveReferral: true, isActive: true },
    });

    res.json({
      verified: true,
      handle: handle.name,
      tier: user.tier,
      genericId: user.genericId,
      trustScore: user.trustScore?.score || 0,
      displayName: user.profile?.displayName || null,
      bio: user.profile?.bio || null,
      photoUrl: user.profile?.photoUrl || null,
      city: user.profile?.city || null,
      profession: user.profile?.profession || null,
      instagram: user.profile?.instagram || null,
      tiktok: user.profile?.tiktok || null,
      facebook: user.profile?.facebook || null,
      twitter: user.profile?.twitter || null,
      youtube: user.profile?.youtube || null,
      website: user.profile?.website || null,
      isReferral: !!referral,
      referralCode: referral?.code || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};