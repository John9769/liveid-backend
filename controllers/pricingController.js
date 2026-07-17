const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Must match the PricingKey enum in schema.prisma exactly
const VALID_PRICING_KEYS = [
  'REGISTRATION_FEE',
  'STANDARD_HANDLE_BASE',
  'CURATED_ADDON',
  'ANNUAL_RENEWAL',
  'RENEWAL_SPECIAL',
  'RENEWAL_SILVER',
  'RENEWAL_GOLDEN',
  'TITLE_RENEWAL_PERCENT',
  'GATEWAY_FEE',
  'REFERRAL_STANDARD_REG',
  'REFERRAL_STANDARD_RENEWAL',
  'REFERRAL_PREMIUM_PERCENT',
  'REFERRAL_TITLE_PERCENT',
  'SUPER_REFERRAL_STANDARD_REG',
  'SUPER_REFERRAL_STANDARD_RENEWAL',
  'SUPER_REFERRAL_PREMIUM_PERCENT',
  'SUPER_REFERRAL_TITLE_PERCENT',
];

exports.getAllPricing = async (req, res) => {
  try {
    const pricing = await prisma.pricingConfig.findMany({
      orderBy: { key: 'asc' },
    });
    res.json({ pricing });
  } catch (err) {
    console.error('getAllPricing error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.updatePricing = async (req, res) => {
  try {
    const { key, value, description } = req.body;

    if (!key || value === undefined || value === null || value === '') {
      return res.status(400).json({ error: 'key and value are required' });
    }

    if (!VALID_PRICING_KEYS.includes(key)) {
      return res.status(400).json({
        error: `Invalid pricing key. Must be one of: ${VALID_PRICING_KEYS.join(', ')}`,
      });
    }

    const parsedValue = parseFloat(value);
    if (isNaN(parsedValue) || parsedValue < 0) {
      return res.status(400).json({ error: 'value must be a number of 0 or more' });
    }

    // Percent keys are percentages, not ringgit — cap at 100
    if (key.includes('PERCENT') && parsedValue > 100) {
      return res.status(400).json({ error: 'Percentage value cannot exceed 100' });
    }

    const existing = await prisma.pricingConfig.findUnique({ where: { key } });
    if (!existing) {
      return res.status(404).json({ error: `Pricing key ${key} is not seeded in the database` });
    }

    const updated = await prisma.pricingConfig.update({
      where: { key },
      data: {
        value: parsedValue,
        description: description !== undefined ? description : existing.description,
      },
    });

    res.json({ message: 'Pricing updated', pricing: updated });
  } catch (err) {
    console.error('updatePricing error:', err.message);
    res.status(500).json({ error: err.message });
  }
};