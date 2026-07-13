const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.joinWaitlist = async (req, res) => {
  try {
    const { type, handleName, name, phone, email, userId } = req.body;

    if (!type || !handleName || !name || !phone || !email) {
      return res.status(400).json({ error: 'type, handleName, name, phone, and email are required' });
    }

    // Check if already on waitlist
    const existing = await prisma.waitlist.findFirst({
      where: { handleName: handleName.toLowerCase(), email, status: 'WAITING' },
    });
    if (existing) {
      return res.status(409).json({ error: 'You are already on the waitlist for this handle' });
    }

    const entry = await prisma.waitlist.create({
      data: {
        type,
        handleName: handleName.toLowerCase(),
        name,
        phone,
        email,
        userId: userId || null,
      },
    });

    res.status(201).json({ message: 'Added to waitlist', entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getWaitlist = async (req, res) => {
  try {
    const { type, status } = req.query;

    const waitlist = await prisma.waitlist.findMany({
      where: {
        type: type || undefined,
        status: status || undefined,
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ waitlist });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getWaitlistByHandle = async (req, res) => {
  try {
    const { handleName } = req.params;

    const waitlist = await prisma.waitlist.findMany({
      where: { handleName: handleName.toLowerCase(), status: 'WAITING' },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ waitlist, count: waitlist.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateWaitlistStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const entry = await prisma.waitlist.update({
      where: { id },
      data: {
        status,
        notifiedAt: status === 'NOTIFIED' ? new Date() : undefined,
      },
    });

    res.json({ message: 'Waitlist status updated', entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};