const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const pricing = [
    { key: 'REGISTRATION_FEE', value: 6.90, description: 'First year registration fee' },
    { key: 'STANDARD_HANDLE_BASE', value: 10.00, description: 'Standard handle base price' },
    { key: 'ANNUAL_RENEWAL', value: 28.00, description: 'Annual renewal fee' },
    { key: 'REFERRAL_STANDARD_REG', value: 5.00, description: 'Referral commission on standard registration' },
    { key: 'REFERRAL_STANDARD_RENEWAL', value: 3.00, description: 'Referral commission on standard renewal' },
    { key: 'REFERRAL_VAULT_PERCENT', value: 10.00, description: 'Referral commission percentage on vault purchases' },
    { key: 'GATEWAY_FEE', value: 1.00, description: 'ToyyibPay gateway fee absorbed by user' },
    { key: 'VAULT_RENEWAL_PERCENT', value: 10.00, description: 'Vault handle annual renewal as percentage of purchase price' },
  ];

  for (const item of pricing) {
    await prisma.pricingConfig.upsert({
      where: { key: item.key },
      update: { value: item.value, description: item.description },
      create: item,
    });
    console.log(`✓ ${item.key} = ${item.value}`);
  }

  console.log('Pricing seeded.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());