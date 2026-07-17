const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ============================================================
// PRICING CONFIG
// ============================================================

const pricing = [
  // ---- User pricing ----
  { key: 'REGISTRATION_FEE', value: 6.90, description: 'First year registration fee' },
  { key: 'STANDARD_HANDLE_BASE', value: 10.00, description: 'Standard handle base price' },
  { key: 'CURATED_ADDON', value: 40.00, description: 'Add-on applied to any curated word variant' },
  { key: 'GATEWAY_FEE', value: 1.00, description: 'ToyyibPay gateway fee absorbed by user' },

  // ---- Renewal — flat per tier ----
  { key: 'ANNUAL_RENEWAL', value: 28.00, description: 'Annual renewal — STANDARD tier' },
  { key: 'RENEWAL_SPECIAL', value: 48.00, description: 'Annual renewal — SPECIAL tier' },
  { key: 'RENEWAL_SILVER', value: 68.00, description: 'Annual renewal — SILVER tier' },
  { key: 'RENEWAL_GOLDEN', value: 88.00, description: 'Annual renewal — GOLDEN tier' },
  { key: 'TITLE_RENEWAL_PERCENT', value: 10.00, description: 'Title handle annual renewal as percentage of purchase price' },

  // ---- Referral — direct commission ----
  { key: 'REFERRAL_STANDARD_REG', value: 5.00, description: 'Referral commission on standard registration' },
  { key: 'REFERRAL_STANDARD_RENEWAL', value: 3.00, description: 'Referral commission on standard renewal' },
  { key: 'REFERRAL_PREMIUM_PERCENT', value: 10.00, description: 'Referral commission percentage on curated word purchases' },
  { key: 'REFERRAL_TITLE_PERCENT', value: 10.00, description: 'Referral commission percentage on title purchases' },

  // ---- Super Referral — override commission. One layer only. ----
  { key: 'SUPER_REFERRAL_STANDARD_REG', value: 2.00, description: 'Super Referral override on standard registration' },
  { key: 'SUPER_REFERRAL_STANDARD_RENEWAL', value: 1.00, description: 'Super Referral override on standard renewal' },
  { key: 'SUPER_REFERRAL_PREMIUM_PERCENT', value: 3.00, description: 'Super Referral override percentage on curated word purchases' },
  { key: 'SUPER_REFERRAL_TITLE_PERCENT', value: 3.00, description: 'Super Referral override percentage on title purchases' },
];

// ============================================================
// CURATED WORDS
//
// Clean words are never sold. The product is the variant:
// a curated word plus a name or number, in any position.
//
// price = (basePrice + CURATED_ADDON) x numberMultiplier
//
// Titles are NOT here. Titles are blocked and sold through
// the TitleRequest flow with documentary proof.
//
// Words under 4 letters are excluded — they collide with too
// many real Malaysian names (ong -> wong, don -> gordon).
// ============================================================

const curatedWords = [
  // GOLDEN — RM388 variant
  { word: 'boss', tier: 'GOLDEN', basePrice: 388 },
  { word: 'king', tier: 'GOLDEN', basePrice: 388 },
  { word: 'queen', tier: 'GOLDEN', basePrice: 388 },
  { word: 'tycoon', tier: 'GOLDEN', basePrice: 388 },
  { word: 'jutawan', tier: 'GOLDEN', basePrice: 388 },
  { word: 'legend', tier: 'GOLDEN', basePrice: 388 },
  { word: 'towkay', tier: 'GOLDEN', basePrice: 388 },

  // SILVER — RM188 variant
  { word: 'prince', tier: 'SILVER', basePrice: 188 },
  { word: 'princess', tier: 'SILVER', basePrice: 188 },
  { word: 'chief', tier: 'SILVER', basePrice: 188 },
  { word: 'alpha', tier: 'SILVER', basePrice: 188 },
  { word: 'master', tier: 'SILVER', basePrice: 188 },
  { word: 'mogul', tier: 'SILVER', basePrice: 188 },
  { word: 'elite', tier: 'SILVER', basePrice: 188 },
  { word: 'warrior', tier: 'SILVER', basePrice: 188 },
  { word: 'champion', tier: 'SILVER', basePrice: 188 },
  { word: 'omega', tier: 'SILVER', basePrice: 188 },
  { word: 'titan', tier: 'SILVER', basePrice: 188 },
  { word: 'phantom', tier: 'SILVER', basePrice: 188 },
  { word: 'founder', tier: 'SILVER', basePrice: 188 },
  { word: 'prestige', tier: 'SILVER', basePrice: 188 },
  { word: 'fortune', tier: 'SILVER', basePrice: 188 },

  // SPECIAL — RM88 variant
  { word: 'rich', tier: 'SPECIAL', basePrice: 88 },
  { word: 'gold', tier: 'SPECIAL', basePrice: 88 },
  { word: 'wealthy', tier: 'SPECIAL', basePrice: 88 },
  { word: 'cash', tier: 'SPECIAL', basePrice: 88 },
  { word: 'premium', tier: 'SPECIAL', basePrice: 88 },
  { word: 'toke', tier: 'SPECIAL', basePrice: 88 },
  { word: 'hebat', tier: 'SPECIAL', basePrice: 88 },
  { word: 'gagah', tier: 'SPECIAL', basePrice: 88 },
  { word: 'diva', tier: 'SPECIAL', basePrice: 88 },
  { word: 'bella', tier: 'SPECIAL', basePrice: 88 },
  { word: 'cantik', tier: 'SPECIAL', basePrice: 88 },
  { word: 'glam', tier: 'SPECIAL', basePrice: 88 },
  { word: 'elegant', tier: 'SPECIAL', basePrice: 88 },
  { word: 'crypto', tier: 'SPECIAL', basePrice: 88 },
  { word: 'cars', tier: 'SPECIAL', basePrice: 88 },
  { word: 'property', tier: 'SPECIAL', basePrice: 88 },
  { word: 'shoes', tier: 'SPECIAL', basePrice: 88 },
  { word: 'gadget', tier: 'SPECIAL', basePrice: 88 },
  { word: 'fashion', tier: 'SPECIAL', basePrice: 88 },
  { word: 'beauty', tier: 'SPECIAL', basePrice: 88 },
  { word: 'homes', tier: 'SPECIAL', basePrice: 88 },
  { word: 'agent', tier: 'SPECIAL', basePrice: 88 },
  { word: 'broker', tier: 'SPECIAL', basePrice: 88 },
  { word: 'huat', tier: 'SPECIAL', basePrice: 88 },
  { word: 'lucky', tier: 'SPECIAL', basePrice: 88 },
  { word: 'prosper', tier: 'SPECIAL', basePrice: 88 },
  { word: 'dragon', tier: 'SPECIAL', basePrice: 88 },
  { word: 'phoenix', tier: 'SPECIAL', basePrice: 88 },
  { word: 'hustler', tier: 'SPECIAL', basePrice: 88 },
  { word: 'grinder', tier: 'SPECIAL', basePrice: 88 },
  { word: 'bosslady', tier: 'SPECIAL', basePrice: 88 },
  { word: 'influencer', tier: 'SPECIAL', basePrice: 88 },
  { word: 'creator', tier: 'SPECIAL', basePrice: 88 },
  { word: 'cyber', tier: 'SPECIAL', basePrice: 88 },
  { word: 'viper', tier: 'SPECIAL', basePrice: 88 },
];

// ============================================================
// TITLE PRICES
//
// Every title requires documentary proof. Admin verifies,
// approves, sets the price, issues a payment link.
// Renewal is 10% of purchase (TITLE_RENEWAL_PERCENT).
// ============================================================

const titlePrices = [
  // ---- Federal and state honours ----
  { title: 'tun', label: 'Tun', price: 6888, renewalFee: 688, sortOrder: 1 },
  { title: 'tohpuan', label: 'Toh Puan', price: 6888, renewalFee: 688, sortOrder: 2 },
  { title: 'tansri', label: 'Tan Sri', price: 3888, renewalFee: 388, sortOrder: 3 },
  { title: 'puansri', label: 'Puan Sri', price: 3888, renewalFee: 388, sortOrder: 4 },
  { title: 'datukseri', label: 'Datuk Seri', price: 1888, renewalFee: 188, sortOrder: 5 },
  { title: 'datoseri', label: "Dato' Seri", price: 1888, renewalFee: 188, sortOrder: 6 },
  { title: 'datinseri', label: 'Datin Seri', price: 1888, renewalFee: 188, sortOrder: 7 },
  { title: 'datukpaduka', label: 'Datuk Paduka', price: 1888, renewalFee: 188, sortOrder: 8 },
  { title: 'datuk', label: 'Datuk', price: 888, renewalFee: 88, sortOrder: 9 },
  { title: 'dato', label: "Dato'", price: 688, renewalFee: 68, sortOrder: 10 },
  { title: 'datin', label: 'Datin', price: 688, renewalFee: 68, sortOrder: 11 },

  // ---- Royal ----
  { title: 'sultan', label: 'Sultan', price: 6888, renewalFee: 688, sortOrder: 20 },
  { title: 'yamtuan', label: 'Yam Tuan', price: 6888, renewalFee: 688, sortOrder: 21 },
  { title: 'tengku', label: 'Tengku', price: 1888, renewalFee: 188, sortOrder: 22 },
  { title: 'tunku', label: 'Tunku', price: 1888, renewalFee: 188, sortOrder: 23 },
  { title: 'engku', label: 'Engku', price: 1888, renewalFee: 188, sortOrder: 24 },
  { title: 'raja', label: 'Raja', price: 1888, renewalFee: 188, sortOrder: 25 },

  // ---- Religious ----
  { title: 'haji', label: 'Haji', price: 288, renewalFee: 28, sortOrder: 30 },
  { title: 'hajah', label: 'Hajah', price: 288, renewalFee: 28, sortOrder: 31 },
  { title: 'ustaz', label: 'Ustaz', price: 288, renewalFee: 28, sortOrder: 32 },
  { title: 'ustazah', label: 'Ustazah', price: 288, renewalFee: 28, sortOrder: 33 },
  { title: 'sheikh', label: 'Sheikh', price: 688, renewalFee: 68, sortOrder: 34 },
  { title: 'syeikh', label: 'Syeikh', price: 688, renewalFee: 68, sortOrder: 35 },
  { title: 'imam', label: 'Imam', price: 288, renewalFee: 28, sortOrder: 36 },
  { title: 'mufti', label: 'Mufti', price: 1888, renewalFee: 188, sortOrder: 37 },

  // ---- Professional ----
  { title: 'dr', label: 'Dr', price: 388, renewalFee: 38, sortOrder: 40 },
  { title: 'doktor', label: 'Doktor', price: 388, renewalFee: 38, sortOrder: 41 },
  { title: 'prof', label: 'Prof', price: 688, renewalFee: 68, sortOrder: 42 },
  { title: 'profesor', label: 'Profesor', price: 688, renewalFee: 68, sortOrder: 43 },
  { title: 'ir', label: 'Ir', price: 388, renewalFee: 38, sortOrder: 44 },
  { title: 'sr', label: 'Sr', price: 388, renewalFee: 38, sortOrder: 45 },
  { title: 'ar', label: 'Ar', price: 388, renewalFee: 38, sortOrder: 46 },

  // ---- Uniformed ----
  { title: 'jeneral', label: 'Jeneral', price: 1888, renewalFee: 188, sortOrder: 50 },
  { title: 'kolonel', label: 'Kolonel', price: 888, renewalFee: 88, sortOrder: 51 },
  { title: 'mejar', label: 'Mejar', price: 688, renewalFee: 68, sortOrder: 52 },
  { title: 'kapten', label: 'Kapten', price: 688, renewalFee: 68, sortOrder: 53 },
  { title: 'inspektor', label: 'Inspektor', price: 688, renewalFee: 68, sortOrder: 54 },
];

// ============================================================
// BLOCKED WORDS
//
// TITLE     — cannot be registered. Sold via TitleRequest only.
// REAL_NAME — a real name that contains a curated word.
//             Skips curated matching, prices at STANDARD.
//
// NOT blocked: syed, sharifah, nik, wan, megat, awang.
// Those are hereditary name components on real ICs, not honours.
// ============================================================

const blockedTitles = [
  // Honours
  'tun', 'tohpuan', 'tansri', 'tanseri', 'puansri', 'puanseri',
  'datukseri', 'datoseri', "dato'seri", 'datinseri', 'datukpaduka',
  'datuk', 'dato', "dato'", 'datin', 'dtk', 'dato_seri', 'datuk_seri',
  // Royal
  'sultan', 'sultanah', 'agong', 'yamtuan', 'yangdipertuan',
  'tengku', 'tunku', 'engku', 'raja', 'permaisuri',
  // Religious
  'haji', 'hajah', 'hj', 'hjh', 'ustaz', 'ustad', 'ustazah',
  'sheikh', 'syeikh', 'syech', 'imam', 'mufti', 'tokguru', 'kadi',
  // Professional
  'dr', 'doktor', 'doctor', 'prof', 'profesor', 'professor',
  'ir', 'sr', 'ar', 'lawyer', 'peguam',
  // Uniformed
  'jeneral', 'general', 'kolonel', 'mejar', 'kapten', 'captain',
  'inspektor', 'asp', 'dsp', 'acp', 'ksp',
];

const blockedRealNames = [
  // rich
  'richard', 'richards', 'richardson', 'ulrich', 'richie', 'richmond',
  // gold
  'goldie', 'marigold', 'goldman', 'goldberg', 'goldsmith',
  // king
  'working', 'viking', 'parking', 'banking', 'making', 'taking',
  'looking', 'talking', 'walking', 'booking', 'cooking', 'kingsley',
  // cars
  'carson', 'carsten',
  // cash
  'cashier', 'cashew',
  // master
  'masterclass', 'mastercard', 'mastermind',
  // alpha
  'alphabet', 'alphanumeric',
  // agent
  'agenda',
  // titan
  'titanic', 'titanium',
  // queen
  'queensland',
  // boss
  'bossa',
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

  console.log('\nClearing old curated words...');
  await prisma.curatedWord.deleteMany({});

  console.log('Seeding curated words...');
  for (const item of curatedWords) {
    await prisma.curatedWord.create({
      data: {
        word: item.word,
        tier: item.tier,
        basePrice: item.basePrice,
        isActive: true,
      },
    });
    console.log(`✓ ${item.word} (${item.tier}) — variant RM${item.basePrice + 40}`);
  }

  console.log('\nSeeding title prices...');
  for (const item of titlePrices) {
    await prisma.titlePrice.upsert({
      where: { title: item.title },
      update: {
        label: item.label,
        price: item.price,
        renewalFee: item.renewalFee,
        requiresDoc: true,
        isActive: true,
        sortOrder: item.sortOrder,
      },
      create: {
        title: item.title,
        label: item.label,
        price: item.price,
        renewalFee: item.renewalFee,
        requiresDoc: true,
        isActive: true,
        sortOrder: item.sortOrder,
      },
    });
    console.log(`✓ ${item.label} — RM${item.price} (renewal RM${item.renewalFee})`);
  }

  console.log('\nClearing old blocked words...');
  await prisma.blockedWord.deleteMany({});

  console.log('Seeding blocked words...');
  for (const word of blockedTitles) {
    await prisma.blockedWord.create({
      data: {
        word,
        category: 'TITLE',
        reason: 'Conferred title — requires documentary proof',
      },
    });
  }
  console.log(`✓ ${blockedTitles.length} titles blocked`);

  for (const word of blockedRealNames) {
    await prisma.blockedWord.create({
      data: {
        word,
        category: 'REAL_NAME',
        reason: 'Real name containing a curated word — prices at STANDARD',
      },
    });
  }
  console.log(`✓ ${blockedRealNames.length} real names whitelisted to STANDARD`);

  // A curated word must not also be a blocked word.
  const blockedAll = [...blockedTitles, ...blockedRealNames];
  const clash = curatedWords.filter((c) => blockedAll.includes(c.word));
  if (clash.length) {
    console.warn(`\n⚠ Curated words that are also blocked: ${clash.map((c) => c.word).join(', ')}`);
  }

  // A curated word under 4 letters collides with real names.
  const tooShort = curatedWords.filter((c) => c.word.length < 4);
  if (tooShort.length) {
    console.warn(`\n⚠ Curated words under 4 letters: ${tooShort.map((c) => c.word).join(', ')}`);
  }

  console.log(
    `\n✅ Seeding complete — ${pricing.length} pricing keys, ${curatedWords.length} curated words, ${titlePrices.length} title prices, ${blockedAll.length} blocked words.`
  );
}

main()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());