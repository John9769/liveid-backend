const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getAllPricing = async (req, res) => {
  try {
    const pricing = await prisma.pricingConfig.findMany({
      orderBy: { key: 'asc' },
    });
    res.json({ pricing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updatePricing = async (req, res) => {
  try {
    const { key, value, description } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key and value are required' });
    }

    const updated = await prisma.pricingConfig.update({
      where: { key },
      data: { value: parseFloat(value), description },
    });

    res.json({ message: 'Pricing updated', pricing: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};