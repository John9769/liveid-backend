// ============================================================
// ONE-OFF BACKFILL
//
// Fills whatsappE164 for profiles that already had a number
// saved before the field existed. Without this, an existing
// user's number cannot be checked until they re-save their
// profile.
//
// Safe to run more than once — it only touches rows where
// whatsappE164 is still null.
//
//   node scripts/backfillWhatsapp.js
// ============================================================

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { normalizePhone } = require('./utils/phone');

const prisma = new PrismaClient();

async function main() {
  const profiles = await prisma.userProfile.findMany({
    where: { whatsapp: { not: null }, whatsappE164: null },
    select: { id: true, userId: true, whatsapp: true },
  });

  console.log(`Found ${profiles.length} profile(s) needing backfill.`);

  let filled = 0;
  let skipped = 0;

  for (const p of profiles) {
    const e164 = normalizePhone(p.whatsapp);

    if (!e164) {
      console.log(`  SKIP  user=${p.userId}  "${p.whatsapp}" is not a valid Malaysian mobile`);
      skipped++;
      continue;
    }

    await prisma.userProfile.update({
      where: { id: p.id },
      data: { whatsappE164: e164 },
    });

    console.log(`  OK    user=${p.userId}  "${p.whatsapp}" -> ${e164}`);
    filled++;
  }

  console.log(`\nDone. ${filled} filled, ${skipped} skipped.`);
  if (skipped) {
    console.log('Skipped numbers stay unmatched until the owner corrects them in their profile.');
  }
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });