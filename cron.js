const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { Resend } = require('resend');

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

// ============================================================
// EXPIRY REMINDERS
//
// Runs daily at 09:00 Malaysia time.
//
// Windows, not exact days. A cron that looks for "exactly 14 days"
// misses that day's cohort forever if the process is asleep when it
// fires. These windows overlap the misses.
//
// Reminders are sent at 14 days, 7 days, 1 day, and on expiry.
// ============================================================

const TZ = 'Asia/Kuala_Lumpur';

function dayWindow(daysFromNow) {
  const target = new Date();
  target.setDate(target.getDate() + daysFromNow);
  const start = new Date(target);
  start.setHours(0, 0, 0, 0);
  const end = new Date(target);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function money(n) {
  return `RM ${Number(n || 0).toFixed(2)}`;
}

function emailShell(inner) {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      ${inner}
      <p style="color: #64748b; font-size: 0.85rem; margin-top: 24px;">
        Powered by LiveID — AWAS Premium Resources (202603141446)
      </p>
    </div>
  `;
}

function renewButton() {
  return `
    <a href="${process.env.FRONTEND_URL}/en/dashboard/renewal"
      style="display: inline-block; margin: 24px 0; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
      Renew My LiveID
    </a>
  `;
}

async function findUsersExpiring(daysFromNow) {
  const { start, end } = dayWindow(daysFromNow);
  return prisma.user.findMany({
    where: {
      registrationExpiry: { gte: start, lte: end },
      isVerified: true,
    },
    include: { activeHandle: true },
  });
}

async function sendBatch(users, buildEmail, label) {
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    if (!user.email) continue;

    const handle = user.activeHandle?.name;
    if (!handle) continue; // no handle, nothing to renew

    const expiryDate = new Date(user.registrationExpiry).toLocaleDateString('en-MY', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    const { subject, html } = buildEmail({
      handle,
      expiryDate,
      amount: user.renewalAmount,
    });

    try {
      await resend.emails.send({
        from: 'LiveID <hello@awas.asia>',
        to: user.email,
        subject,
        html,
      });
      sent++;
    } catch (err) {
      failed++;
      console.error(`[CRON] ${label} — failed for ${user.email}:`, err.message);
    }

    // Resend rate limit — space the sends out
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(`[CRON] ${label}: ${sent} sent, ${failed} failed, ${users.length} matched`);
}

// ---- 14 days out ----------------------------------------------------

function build14Day({ handle, expiryDate, amount }) {
  return {
    subject: 'Your LiveID expires in 14 days',
    html: emailShell(`
      <h2 style="color: #0f172a;">Your LiveID is expiring soon</h2>
      <p>Your verified handle <strong>liveid.asia/${handle}</strong> expires on <strong>${expiryDate}</strong>.</p>
      <p>Renewal is ${amount ? `<strong>${money(amount)}</strong>` : 'due now'} for another year of Verified Human status.</p>
      ${renewButton()}
      <p style="color: #64748b; font-size: 0.85rem;">
        Your handle stays yours — it is never given to anyone else. But once it expires,
        anyone who clicks your link will see an <strong>Expired</strong> notice instead of
        your verification. Renew to keep your green check.
      </p>
    `),
  };
}

// ---- 7 days out -----------------------------------------------------

function build7Day({ handle, expiryDate, amount }) {
  return {
    subject: 'Your LiveID expires in 7 days',
    html: emailShell(`
      <h2 style="color: #0f172a;">7 days left</h2>
      <p><strong>liveid.asia/${handle}</strong> expires on <strong>${expiryDate}</strong>.</p>
      <p>Renewal: ${amount ? `<strong>${money(amount)}</strong>` : 'due now'}.</p>
      ${renewButton()}
      <p style="color: #64748b; font-size: 0.85rem;">
        After expiry your link keeps working, but it will show an Expired notice to
        anyone who checks you.
      </p>
    `),
  };
}

// ---- 1 day out ------------------------------------------------------

function build1Day({ handle, expiryDate, amount }) {
  return {
    subject: 'Your LiveID expires tomorrow',
    html: emailShell(`
      <h2 style="color: #B3261E;">Expiring tomorrow</h2>
      <p><strong>liveid.asia/${handle}</strong> expires on <strong>${expiryDate}</strong>.</p>
      <p>Renewal: ${amount ? `<strong>${money(amount)}</strong>` : 'due now'}.</p>
      ${renewButton()}
      <p style="color: #64748b; font-size: 0.85rem;">
        From tomorrow, anyone clicking your link sees an Expired notice.
      </p>
    `),
  };
}

// ---- expired today --------------------------------------------------

function buildExpired({ handle, amount }) {
  return {
    subject: 'Your LiveID has expired',
    html: emailShell(`
      <h2 style="color: #B3261E;">Your LiveID has expired</h2>
      <p><strong>liveid.asia/${handle}</strong> is no longer verified.</p>
      <p>
        Anyone clicking your link now sees an <strong>Expired</strong> notice.
        If your link is in your bio, it is currently telling people you are unverified.
      </p>
      ${renewButton()}
      <p style="color: #64748b; font-size: 0.85rem;">
        <strong>Your handle is still yours.</strong> LiveID never releases a retired handle
        to anyone else — that is what makes verification meaningful. Renew any time
        ${amount ? `for ${money(amount)}` : ''} and your green check returns immediately.
      </p>
    `),
  };
}

// ============================================================
// SCHEDULE — one job, four windows, sequential
// ============================================================

cron.schedule(
  '0 9 * * *',
  async () => {
    console.log('[CRON] Expiry reminder run starting...');

    try {
      const [d14, d7, d1, d0] = await Promise.all([
        findUsersExpiring(14),
        findUsersExpiring(7),
        findUsersExpiring(1),
        findUsersExpiring(0),
      ]);

      await sendBatch(d14, build14Day, '14-day');
      await sendBatch(d7, build7Day, '7-day');
      await sendBatch(d1, build1Day, '1-day');
      await sendBatch(d0, buildExpired, 'expired');

      console.log('[CRON] Expiry reminder run complete.');
    } catch (err) {
      console.error('[CRON] Expiry reminder error:', err.message);
    }
  },
  { timezone: TZ }
);

console.log(`Cron: expiry reminders active — daily 09:00 ${TZ} (14d, 7d, 1d, expired)`);