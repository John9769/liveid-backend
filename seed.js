const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ============================================================
// PRICING CONFIG
// ============================================================

const pricing = [
  // ---- User pricing ----
  { key: 'REGISTRATION_FEE', value: 6.90, description: 'First year registration fee' },
  { key: 'STANDARD_HANDLE_BASE', value: 10.00, description: 'Standard handle base price' },
  { key: 'ANNUAL_RENEWAL', value: 28.00, description: 'Annual renewal fee' },
  { key: 'GATEWAY_FEE', value: 1.00, description: 'ToyyibPay gateway fee absorbed by user' },
  { key: 'VAULT_RENEWAL_PERCENT', value: 10.00, description: 'Vault handle annual renewal as percentage of purchase price' },

  // ---- Referral — direct commission ----
  { key: 'REFERRAL_STANDARD_REG', value: 5.00, description: 'Referral commission on standard registration' },
  { key: 'REFERRAL_STANDARD_RENEWAL', value: 3.00, description: 'Referral commission on standard renewal' },
  { key: 'REFERRAL_VAULT_PERCENT', value: 10.00, description: 'Referral commission percentage on vault and premium purchases' },

  // ---- Super Referral — override commission. One layer only. ----
  { key: 'SUPER_REFERRAL_STANDARD_REG', value: 2.00, description: 'Super Referral override on standard registration' },
  { key: 'SUPER_REFERRAL_STANDARD_RENEWAL', value: 1.00, description: 'Super Referral override on standard renewal' },
  { key: 'SUPER_REFERRAL_VAULT_PERCENT', value: 3.00, description: 'Super Referral override percentage on vault and premium purchases' },
];

// ============================================================
// CURATED WORDS
//
// Variant pricing is derived: basePrice x number multiplier.
// e.g. boss88 = 688 x 1.2 = RM826
// There is no separate variant price column — the multiplier is
// the single source of truth for every variant.
// ============================================================

const curatedWords = [
  // GOLDEN tier — these are also Vault words
  { word: 'boss', tier: 'GOLDEN', basePrice: 688, isVault: true, vaultPrice: 4888, vaultRenewalFee: 488 },
  { word: 'king', tier: 'GOLDEN', basePrice: 688, isVault: true, vaultPrice: 6888, vaultRenewalFee: 688 },
  { word: 'queen', tier: 'GOLDEN', basePrice: 688, isVault: true, vaultPrice: 6888, vaultRenewalFee: 688 },
  { word: 'vip', tier: 'GOLDEN', basePrice: 688, isVault: false },
  { word: 'dato', tier: 'GOLDEN', basePrice: 688, isVault: true, vaultPrice: 4888, vaultRenewalFee: 488 },
  { word: 'datuk', tier: 'GOLDEN', basePrice: 688, isVault: true, vaultPrice: 4888, vaultRenewalFee: 488 },
  { word: 'ceo', tier: 'GOLDEN', basePrice: 688, isVault: true, vaultPrice: 3888, vaultRenewalFee: 388 },

  // SILVER tier — some are Vault words
  { word: 'prince', tier: 'SILVER', basePrice: 388, isVault: true, vaultPrice: 3888, vaultRenewalFee: 388 },
  { word: 'princess', tier: 'SILVER', basePrice: 388, isVault: true, vaultPrice: 3888, vaultRenewalFee: 388 },
  { word: 'chief', tier: 'SILVER', basePrice: 388, isVault: false },
  { word: 'alpha', tier: 'SILVER', basePrice: 388, isVault: true, vaultPrice: 2888, vaultRenewalFee: 288 },
  { word: 'legend', tier: 'SILVER', basePrice: 388, isVault: true, vaultPrice: 3888, vaultRenewalFee: 388 },
  { word: 'master', tier: 'SILVER', basePrice: 388, isVault: true, vaultPrice: 2888, vaultRenewalFee: 288 },
  { word: 'don', tier: 'SILVER', basePrice: 388, isVault: false },
  { word: 'mogul', tier: 'SILVER', basePrice: 388, isVault: false },
  { word: 'tycoon', tier: 'SILVER', basePrice: 388, isVault: true, vaultPrice: 3888, vaultRenewalFee: 388 },
  { word: 'elite', tier: 'SILVER', basePrice: 388, isVault: true, vaultPrice: 2888, vaultRenewalFee: 288 },
  { word: 'warrior', tier: 'SILVER', basePrice: 388, isVault: true, vaultPrice: 2888, vaultRenewalFee: 288 },
  { word: 'champion', tier: 'SILVER', basePrice: 388, isVault: true, vaultPrice: 2888, vaultRenewalFee: 288 },
  { word: 'hero', tier: 'SILVER', basePrice: 388, isVault: true, vaultPrice: 2888, vaultRenewalFee: 288 },
  { word: 'omega', tier: 'SILVER', basePrice: 388, isVault: true, vaultPrice: 2888, vaultRenewalFee: 288 },

  // SPECIAL tier
  { word: 'rich', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'gold', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'wealthy', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'cash', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'fortune', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'prestige', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'premium', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'bos', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'toke', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'jutawan', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'hebat', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'gagah', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'diva', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'bella', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'cantik', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'glam', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'elegant', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'crypto', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'cars', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'property', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'shoes', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'gadget', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'fashion', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'beauty', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'homes', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'agent', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'broker', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'huat', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'ong', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'lucky', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'prosper', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'dragon', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'phoenix', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'hustler', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'grinder', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'bosslady', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'influencer', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'creator', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'founder', tier: 'SPECIAL', basePrice: 188, isVault: false },
  { word: 'cyber', tier: 'SPECIAL', basePrice: 188, isVault: true, vaultPrice: 1888, vaultRenewalFee: 188 },
  { word: 'phantom', tier: 'SPECIAL', basePrice: 188, isVault: true, vaultPrice: 1888, vaultRenewalFee: 188 },
  { word: 'viper', tier: 'SPECIAL', basePrice: 188, isVault: true, vaultPrice: 1888, vaultRenewalFee: 188 },
  { word: 'titan', tier: 'SPECIAL', basePrice: 188, isVault: true, vaultPrice: 1888, vaultRenewalFee: 188 },
];

// ============================================================
// VAULT HANDLES — Crown jewel clean words
// ============================================================

const vaultHandles = [
  { name: 'king', tier: 'VAULT', baseWord: 'king', buyNowPrice: 6888, reservePrice: 5000, renewalFee: 688 },
  { name: 'queen', tier: 'VAULT', baseWord: 'queen', buyNowPrice: 6888, reservePrice: 5000, renewalFee: 688 },
  { name: 'boss', tier: 'VAULT', baseWord: 'boss', buyNowPrice: 4888, reservePrice: 3500, renewalFee: 488 },
  { name: 'dato', tier: 'VAULT', baseWord: 'dato', buyNowPrice: 4888, reservePrice: 3500, renewalFee: 488 },
  { name: 'datuk', tier: 'VAULT', baseWord: 'datuk', buyNowPrice: 4888, reservePrice: 3500, renewalFee: 488 },
  { name: 'prince', tier: 'VAULT', baseWord: 'prince', buyNowPrice: 3888, reservePrice: 2800, renewalFee: 388 },
  { name: 'princess', tier: 'VAULT', baseWord: 'princess', buyNowPrice: 3888, reservePrice: 2800, renewalFee: 388 },
  { name: 'legend', tier: 'VAULT', baseWord: 'legend', buyNowPrice: 3888, reservePrice: 2800, renewalFee: 388 },
  { name: 'tycoon', tier: 'VAULT', baseWord: 'tycoon', buyNowPrice: 3888, reservePrice: 2800, renewalFee: 388 },
  { name: 'ceo', tier: 'VAULT', baseWord: 'ceo', buyNowPrice: 3888, reservePrice: 2800, renewalFee: 388 },
  { name: 'alpha', tier: 'VAULT', baseWord: 'alpha', buyNowPrice: 2888, reservePrice: 2000, renewalFee: 288 },
  { name: 'master', tier: 'VAULT', baseWord: 'master', buyNowPrice: 2888, reservePrice: 2000, renewalFee: 288 },
  { name: 'elite', tier: 'VAULT', baseWord: 'elite', buyNowPrice: 2888, reservePrice: 2000, renewalFee: 288 },
  { name: 'warrior', tier: 'VAULT', baseWord: 'warrior', buyNowPrice: 2888, reservePrice: 2000, renewalFee: 288 },
  { name: 'champion', tier: 'VAULT', baseWord: 'champion', buyNowPrice: 2888, reservePrice: 2000, renewalFee: 288 },
  { name: 'hero', tier: 'VAULT', baseWord: 'hero', buyNowPrice: 2888, reservePrice: 2000, renewalFee: 288 },
  { name: 'omega', tier: 'VAULT', baseWord: 'omega', buyNowPrice: 2888, reservePrice: 2000, renewalFee: 288 },
  { name: 'cyber', tier: 'VAULT', baseWord: 'cyber', buyNowPrice: 1888, reservePrice: 1200, renewalFee: 188 },
  { name: 'phantom', tier: 'VAULT', baseWord: 'phantom', buyNowPrice: 1888, reservePrice: 1200, renewalFee: 188 },
  { name: 'viper', tier: 'VAULT', baseWord: 'viper', buyNowPrice: 1888, reservePrice: 1200, renewalFee: 188 },
  { name: 'titan', tier: 'VAULT', baseWord: 'titan', buyNowPrice: 1888, reservePrice: 1200, renewalFee: 188 },
];

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('Seeding pricing config...');
  for (const item of pricing) {
    await prisma.pricingConfig.upsert({
      where: { key: item.key },
      update: { value: item.value, description: item.description },
      create: item,
    });
    console.log(`✓ ${item.key} = ${item.value}`);
  }

  console.log('\nSeeding curated words...');
  for (const item of curatedWords) {
    await prisma.curatedWord.upsert({
      where: { word: item.word },
      update: {
        tier: item.tier,
        basePrice: item.basePrice,
        isVault: item.isVault,
        vaultPrice: item.vaultPrice ?? null,
        vaultRenewalFee: item.vaultRenewalFee ?? null,
        vaultVariantPrice: null,
      },
      create: {
        word: item.word,
        tier: item.tier,
        basePrice: item.basePrice,
        isVault: item.isVault,
        vaultPrice: item.vaultPrice ?? null,
        vaultRenewalFee: item.vaultRenewalFee ?? null,
        vaultVariantPrice: null,
      },
    });
    console.log(`✓ ${item.word} (${item.tier})${item.isVault ? ' [VAULT]' : ''}`);
  }

  console.log('\nSeeding vault handles...');
  for (const item of vaultHandles) {
    await prisma.vaultHandle.upsert({
      where: { name: item.name },
      update: {
        tier: item.tier,
        baseWord: item.baseWord,
        buyNowPrice: item.buyNowPrice,
        reservePrice: item.reservePrice,
        renewalFee: item.renewalFee,
      },
      create: item,
    });
    console.log(`✓ liveid.asia/${item.name} — RM${item.buyNowPrice} (reserve: RM${item.reservePrice})`);
  }

  // Every vault handle must have a matching curated word, or
  // calculatePricing falls back to STANDARD_HANDLE_BASE for its variants.
  const vaultNames = vaultHandles.map((v) => v.name);
  const curatedNames = curatedWords.map((c) => c.word);
  const orphans = vaultNames.filter((n) => !curatedNames.includes(n));
  if (orphans.length) {
    console.warn(`\n⚠ Vault handles with no curated word: ${orphans.join(', ')}`);
  }

  console.log(`\n✅ Seeding complete — ${pricing.length} pricing keys, ${curatedWords.length} words, ${vaultHandles.length} vault handles.`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());