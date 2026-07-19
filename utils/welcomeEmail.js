const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Welcome email — sent after successful registration.
// Kept in its own file so the HTML can be edited without touching
// the transaction callback. Never throws to the caller — a failed
// email must not break the callback, since the account is already live.
async function sendWelcomeEmail(data) {
  const handle = data.handleName;
  const loginUrl = `${process.env.FRONTEND_URL}/en/login`;

  const expiryEN = new Date(data.registrationExpiry).toLocaleDateString('en-MY', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const expiryBM = new Date(data.registrationExpiry).toLocaleDateString('ms-MY', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  try {
    await resend.emails.send({
      from: 'LiveID <hello@awas.asia>',
      to: data.email,
      subject: `You're verified — 2 steps to finish / Anda telah disahkan — 2 langkah terakhir`,
      html: `
        <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #0f172a;">
          <p style="font-size: 0.72rem; letter-spacing: 0.14em; color: #0f766e; text-transform: uppercase; margin-bottom: 8px;">
            LiveID Verified
          </p>
          <h1 style="font-size: 1.5rem; margin: 0 0 8px;">You're verified.</h1>
          <p style="font-size: 1.2rem; font-weight: 700; color: #3b82f6; margin: 0 0 20px; font-family: monospace;">
            liveid.asia/${handle}
          </p>

          <!-- ============ ENGLISH ============ -->
          <p style="font-size: 0.9rem; line-height: 1.7; margin: 0 0 20px;">
            Your LiveID is live. Finish these steps so your page protects you and works for you.
          </p>

          <div style="background: #FFF8E1; border: 1px solid #F59E0B; border-radius: 8px; padding: 16px 20px; margin: 0 0 16px;">
            <p style="font-size: 0.8rem; font-weight: 700; color: #92400E; margin: 0 0 10px;">
              STEP 1 — Add your real social accounts (important)
            </p>
            <p style="font-size: 0.85rem; line-height: 1.7; color: #92400E; margin: 0 0 10px;">
              This is what stops scammers copying your link. Without your real accounts listed,
              buyers see a <strong>scam warning</strong> instead of a trust badge.
            </p>
            <ul style="font-size: 0.85rem; line-height: 1.8; color: #92400E; margin: 0; padding-left: 18px;">
              <li>Log in to your dashboard</li>
              <li>Go to <strong>Edit Profile</strong></li>
              <li>Add your Instagram, Facebook, TikTok links</li>
              <li>Save</li>
            </ul>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px;">
            <p style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 10px;">
              STEP 2 — Selling something? Set up your shop
            </p>
            <ul style="font-size: 0.85rem; line-height: 1.8; margin: 0; padding-left: 18px;">
              <li>In <strong>Edit Profile</strong>, turn on <strong>My Shop</strong></li>
              <li>Fill your shop title and area, then Save</li>
              <li>Go to <strong>My Shop</strong> and add your items (name, price, details)</li>
              <li>Tick <strong>Images on request</strong> for items with photos</li>
            </ul>
            <p style="font-size: 0.82rem; line-height: 1.6; color: #64748b; margin: 10px 0 0;">
              Buyers see your shop on your verified page after they confirm you are real.
            </p>
          </div>

          <p style="font-size: 0.85rem; line-height: 1.7; margin: 0 0 20px;">
            <strong>Then share your link.</strong> Put
            <span style="font-family: monospace;">liveid.asia/${handle}</span>
            in your Instagram/TikTok bio, your Facebook, and your WhatsApp Business profile.
          </p>

          <a href="${loginUrl}"
            style="display: inline-block; margin: 0 0 20px; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
            Log in to my dashboard
          </a>

          <p style="font-size: 0.8rem; line-height: 1.7; color: #64748b; margin: 0 0 24px;">
            Your LiveID is valid until <strong>${expiryEN}</strong>.
            Your handle is yours permanently — but if you do not renew, anyone checking your link sees an Expired notice.
          </p>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">

          <!-- ============ BAHASA MELAYU ============ -->
          <p style="font-size: 0.9rem; line-height: 1.7; margin: 0 0 20px;">
            LiveID anda sudah aktif. Lengkapkan langkah ini supaya halaman anda melindungi dan berfungsi untuk anda.
          </p>

          <div style="background: #FFF8E1; border: 1px solid #F59E0B; border-radius: 8px; padding: 16px 20px; margin: 0 0 16px;">
            <p style="font-size: 0.8rem; font-weight: 700; color: #92400E; margin: 0 0 10px;">
              LANGKAH 1 — Masukkan akaun media sosial sebenar anda (penting)
            </p>
            <p style="font-size: 0.85rem; line-height: 1.7; color: #92400E; margin: 0 0 10px;">
              Ini menghalang penipu menyalin pautan anda. Tanpa akaun sebenar disenaraikan,
              pembeli akan nampak <strong>amaran penipuan</strong>, bukan lencana kepercayaan.
            </p>
            <ul style="font-size: 0.85rem; line-height: 1.8; color: #92400E; margin: 0; padding-left: 18px;">
              <li>Log masuk ke dashboard anda</li>
              <li>Pergi ke <strong>Edit Profile</strong></li>
              <li>Masukkan pautan Instagram, Facebook, TikTok anda</li>
              <li>Simpan</li>
            </ul>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px;">
            <p style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 10px;">
              LANGKAH 2 — Menjual sesuatu? Sediakan kedai anda
            </p>
            <ul style="font-size: 0.85rem; line-height: 1.8; margin: 0; padding-left: 18px;">
              <li>Dalam <strong>Edit Profile</strong>, hidupkan <strong>My Shop</strong></li>
              <li>Isi tajuk kedai dan kawasan, kemudian Simpan</li>
              <li>Pergi ke <strong>My Shop</strong> dan tambah barang anda (nama, harga, butiran)</li>
              <li>Tanda <strong>Images on request</strong> untuk barang yang ada gambar</li>
            </ul>
            <p style="font-size: 0.82rem; line-height: 1.6; color: #64748b; margin: 10px 0 0;">
              Pembeli akan nampak kedai anda pada halaman disahkan selepas mereka pasti anda betul-betul wujud.
            </p>
          </div>

          <p style="font-size: 0.85rem; line-height: 1.7; margin: 0 0 20px;">
            <strong>Kemudian kongsi pautan anda.</strong> Letak
            <span style="font-family: monospace;">liveid.asia/${handle}</span>
            dalam bio Instagram/TikTok, Facebook, dan profil WhatsApp Business anda.
          </p>

          <p style="font-size: 0.8rem; line-height: 1.7; color: #64748b; margin: 0 0 4px;">
            LiveID anda sah sehingga <strong>${expiryBM}</strong>.
            Handle ini milik anda selamanya — tetapi jika tidak diperbaharui, sesiapa yang menyemak pautan anda akan nampak notis Tamat Tempoh.
          </p>

          <p style="font-size: 0.8rem; color: #64748b; margin-top: 24px;">
            Powered by LiveID — liveid.asia<br>
            AWAS Premium Resources (202603141446)
          </p>
        </div>
      `,
    });
  } catch (emailErr) {
    console.error('Welcome email failed:', emailErr.message);
  }
}

module.exports = { sendWelcomeEmail };