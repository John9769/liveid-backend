const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('liveid@admin2026', 10);

  const admin = await prisma.admin.upsert({
    where: { email: 'admin@liveid.asia' },
    update: {},
    create: {
      email: 'admin@liveid.asia',
      passwordHash,
      name: 'John — AWAS Premium Resources',
    },
  });

  console.log('✅ Admin seeded:', admin.email);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());