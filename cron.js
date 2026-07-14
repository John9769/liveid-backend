const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { Resend } = require('resend');

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

// ============================================================
// EXPIRY REMINDER — runs every day at 9AM
// Sends email 14 days before expiry
// ============================================================

cron.schedule('0 9 * * *', async () => {
  console.log('[CRON] Running expiry reminder check...');

  try {
    const now = new Date();
    const reminderDate = new Date(now);
    reminderDate.setDate(reminderDate.getDate() + 14);

    // Find users expiring in exactly 14 days
    const startOfDay = new Date(reminderDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(reminderDate);
    endOfDay.setHours(23, 59, 59, 999);

    const expiringUsers = await prisma.user.findMany({
      where: {
        registrationExpiry: {
          gte: startOfDay,
          lte: endOfDay,
        },
        isVerified: true,
      },
      include: { activeHandle: true },
    });

    console.log(`[CRON] Found ${expiringUsers.length} users expiring in 14 days`);

    for (const user of expiringUsers) {
      const handle = user.activeHandle?.name || 'your handle';
      const expiryDate = new Date(user.registrationExpiry).toLocaleDateString('en-MY', {
        day: 'numeric', month: 'long', year: 'numeric',
      });

      try {
        await resend.emails.send({
          from: 'LiveID <hello@awas.asia>',
          to: user.email,
          subject: 'Your LiveID expires in 14 days',
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
              <h2 style="color: #0f172a;">Your LiveID is expiring soon</h2>
              <p>Hi there,</p>
              <p>Your verified handle <strong>liveid.asia/${handle}</strong> will expire on <strong>${expiryDate}</strong>.</p>
              <p>Renew now to keep your Verified Human status active and your handle reserved.</p>
              <a href="${process.env.FRONTEND_URL}/en/dashboard/renewal" 
                style="display: inline-block; margin: 24px 0; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
                Renew My LiveID
              </a>
              <p style="color: #64748b; font-size: 0.85rem;">
                If you do not renew, your handle will be deactivated and may be claimed by someone else.
              </p>
              <p style="color: #64748b; font-size: 0.85rem;">
                Powered by LiveID — AWAS Premium Resources (202603141446)
              </p>
            </div>
          `,
        });
        console.log(`[CRON] Reminder sent to ${user.email} for handle ${handle}`);
      } catch (emailErr) {
        console.error(`[CRON] Failed to send reminder to ${user.email}:`, emailErr.message);
      }
    }

    console.log('[CRON] Expiry reminder check complete.');
  } catch (err) {
    console.error('[CRON] Expiry reminder error:', err.message);
  }
});

console.log('Cron jobs: expiry reminder active (runs daily at 9AM)');