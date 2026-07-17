require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { Resend } = require('resend');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ============================================================
// HELPERS
// ============================================================

async function getPricing() {
  const configs = await prisma.pricingConfig.findMany();
  const map = {};
  for (const c of configs) map[c.key] = c.value;
  return map;
}

// Which blocked title sits inside this handle. Longest match wins —
// datukseri must beat datuk.
async function findTitleInHandle(letters) {
  const titles = await prisma.blockedWord.findMany({ where: { category: 'TITLE' } });

  let best = null;
  for (const t of titles) {
    if (!letters.includes(t.word)) continue;
    if (!best || t.word.length > best.word.length) best = t;
  }
  return best ? best.word : null;
}

function emailShell(inner) {
  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #0f172a;">
      <p style="font-size: 0.72rem; letter-spacing: 0.14em; color: #0f766e; text-transform: uppercase; margin-bottom: 8px;">
        LiveID
      </p>
      ${inner}
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
      <p style="font-size: 0.8rem; color: #64748b;">
        Powered by LiveID — liveid.asia<br>
        AWAS Premium Resources (202603141446)
      </p>
    </div>
  `;
}

// ============================================================
// LIST TITLE PRICES — public
// Powers the title request form dropdown.
// ============================================================

exports.listTitlePrices = async (req, res) => {
  try {
    const titles = await prisma.titlePrice.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ titles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// SUBMIT TITLE REQUEST — public
// Multipart. The document is the whole point of this route.
// ============================================================

exports.submitTitleRequest = async (req, res) => {
  try {
    const { handleName, fullName, phone, email, title, awardYear, awardBody } = req.body;

    if (!handleName || !fullName || !phone || !email || !title) {
      return res.status(400).json({ error: 'handleName, fullName, phone, email and title are required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'A document proving the title is required' });
    }

    const cleanName = handleName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanName) return res.status(400).json({ error: 'Invalid handle name' });

    const cleanTitle = title.trim().toLowerCase().replace(/[^a-z_']/g, '');

    // The title must actually be in the handle they asked for
    const letters = cleanName.replace(/[0-9]/g, '').replace(/_/g, '');
    const titleInHandle = await findTitleInHandle(letters);
    if (!titleInHandle) {
      return res.status(400).json({ error: 'This handle does not contain a title. Register it normally instead.' });
    }
    if (titleInHandle !== cleanTitle) {
      return res.status(400).json({
        error: `The handle contains "${titleInHandle}", not "${cleanTitle}". Select the correct title.`,
      });
    }

    const titlePrice = await prisma.titlePrice.findUnique({ where: { title: cleanTitle } });
    if (!titlePrice || !titlePrice.isActive) {
      return res.status(404).json({ error: 'This title is not available' });
    }

    // Taken handles are not requestable
    const existingHandle = await prisma.handle.findUnique({ where: { name: cleanName } });
    if (existingHandle && existingHandle.status === 'ACTIVE') {
      return res.status(409).json({ error: 'This handle is already taken' });
    }

    // One open request per handle
    const openRequest = await prisma.titleRequest.findFirst({
      where: { handleName: cleanName, status: { in: ['PENDING', 'APPROVED'] } },
    });
    if (openRequest) {
      return res.status(409).json({ error: 'There is already an open request for this handle' });
    }

    const streamUpload = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'liveid_title_documents',
            resource_type: 'auto',
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });

    const uploadResult = await streamUpload();

    // Link to an existing account if this email already has one
    const existingUser = await prisma.user.findUnique({ where: { email: email.trim() } });

    const request = await prisma.titleRequest.create({
      data: {
        userId: existingUser ? existingUser.id : null,
        handleName: cleanName,
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        title: cleanTitle,
        awardYear: awardYear ? parseInt(awardYear) : null,
        awardBody: awardBody ? awardBody.trim() : null,
        documentUrl: uploadResult.secure_url,
        status: 'PENDING',
      },
    });

    console.log('TITLE REQUEST | handle=%s | title=%s | email=%s | req=%s',
      cleanName, cleanTitle, email, request.id);

    // Applicant confirmation
    try {
      await resend.emails.send({
        from: 'LiveID <hello@awas.asia>',
        to: email.trim(),
        subject: `Title request received — liveid.asia/${cleanName}`,
        html: emailShell(`
          <h1 style="font-size: 1.4rem; margin: 0 0 16px;">We have your request.</h1>
          <p style="font-size: 0.9rem; line-height: 1.7;">
            You asked for <strong style="font-family: monospace;">liveid.asia/${cleanName}</strong>
            under the title <strong>${titlePrice.label}</strong>.
          </p>
          <p style="font-size: 0.9rem; line-height: 1.7;">
            We check every title against the awarding authority before we issue the handle.
            This is what makes a LiveID title worth carrying — nobody can buy one.
          </p>
          <p style="font-size: 0.9rem; line-height: 1.7;">
            If your document checks out, we will email you a payment link for
            <strong>RM${titlePrice.price}</strong>. If it does not, we will tell you why.
            You are not charged anything until it is approved.
          </p>
          <p style="font-size: 0.85rem; color: #64748b; line-height: 1.7;">
            Your handle is held for you while we review.
          </p>
        `),
      });
    } catch (e) {
      console.error('Title request email failed:', e.message);
    }

    // Admin alert
    try {
      const admin = await prisma.admin.findFirst();
      if (admin) {
        await resend.emails.send({
          from: 'LiveID <hello@awas.asia>',
          to: admin.email,
          subject: `TITLE REQUEST — ${titlePrice.label} — ${cleanName}`,
          html: emailShell(`
            <h1 style="font-size: 1.4rem; margin: 0 0 16px;">New title request</h1>
            <p style="font-size: 0.9rem; line-height: 1.9;">
              <strong>Handle:</strong> liveid.asia/${cleanName}<br>
              <strong>Title:</strong> ${titlePrice.label} — RM${titlePrice.price}<br>
              <strong>Name:</strong> ${fullName}<br>
              <strong>Phone:</strong> ${phone}<br>
              <strong>Email:</strong> ${email}<br>
              <strong>Award year:</strong> ${awardYear || '—'}<br>
              <strong>Awarded by:</strong> ${awardBody || '—'}
            </p>
            <a href="${uploadResult.secure_url}"
              style="display: inline-block; margin: 16px 0; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
              View document
            </a>
          `),
        });
      }
    } catch (e) {
      console.error('Admin alert email failed:', e.message);
    }

    res.status(201).json({
      message: 'Title request submitted',
      requestId: request.id,
      title: titlePrice.label,
      price: titlePrice.price,
    });
  } catch (err) {
    console.error('submitTitleRequest error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// CHECK REQUEST STATUS — public
// ============================================================

exports.getTitleRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await prisma.titleRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: 'Request not found' });

    res.json({
      id: request.id,
      handleName: request.handleName,
      title: request.title,
      status: request.status,
      approvedPrice: request.approvedPrice,
      adminNotes: request.status === 'REJECTED' ? request.adminNotes : null,
      createdAt: request.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — LIST REQUESTS
// ============================================================

exports.listTitleRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? { status } : {};

    const requests = await prisma.titleRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, genericId: true, email: true, phone: true },
        },
      },
    });

    const counts = await prisma.titleRequest.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    res.json({
      requests,
      counts: counts.reduce((acc, c) => ({ ...acc, [c.status]: c._count.status }), {}),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — REJECT
// ============================================================

exports.rejectTitleRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body;

    if (!adminNotes) {
      return res.status(400).json({ error: 'adminNotes is required — the applicant is told why' });
    }

    const request = await prisma.titleRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'PENDING') {
      return res.status(409).json({ error: `Request is already ${request.status}` });
    }

    const updated = await prisma.titleRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        adminNotes,
        reviewedAt: new Date(),
      },
    });

    try {
      await resend.emails.send({
        from: 'LiveID <hello@awas.asia>',
        to: request.email,
        subject: `Title request — liveid.asia/${request.handleName}`,
        html: emailShell(`
          <h1 style="font-size: 1.4rem; margin: 0 0 16px;">We could not verify this title.</h1>
          <p style="font-size: 0.9rem; line-height: 1.7;">
            Your request for <strong style="font-family: monospace;">liveid.asia/${request.handleName}</strong>
            was not approved.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 24px 0;">
            <p style="font-size: 0.85rem; line-height: 1.7; margin: 0;">${adminNotes}</p>
          </div>
          <p style="font-size: 0.9rem; line-height: 1.7;">
            You were not charged. If you have a clearer document, submit a new request.
          </p>
          <p style="font-size: 0.9rem; line-height: 1.7;">
            You can also register any handle without a title — that takes a minute and costs RM17.90.
          </p>
        `),
      });
    } catch (e) {
      console.error('Rejection email failed:', e.message);
    }

    res.json({ message: 'Request rejected', request: updated });
  } catch (err) {
    console.error('rejectTitleRequest error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — APPROVE
//
// Approval creates the ToyyibPay bill and emails the link.
// The handle is only created when the callback lands.
// The applicant must already have a LiveID account — the title
// handle replaces their existing handle.
// ============================================================

exports.approveTitleRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { approvedPrice, adminNotes } = req.body;

    const request = await prisma.titleRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'PENDING') {
      return res.status(409).json({ error: `Request is already ${request.status}` });
    }

    // The handle must still be free
    const existingHandle = await prisma.handle.findUnique({ where: { name: request.handleName } });
    if (existingHandle && existingHandle.status === 'ACTIVE') {
      return res.status(409).json({ error: 'This handle was taken while the request was open' });
    }

    // They need an account before they can hold a handle
    const user = await prisma.user.findUnique({ where: { email: request.email } });
    if (!user) {
      return res.status(409).json({
        error: 'This applicant has no LiveID account. They must register first, then the title handle can replace their handle.',
        needsAccount: true,
        email: request.email,
      });
    }

    const titlePrice = await prisma.titlePrice.findUnique({ where: { title: request.title } });
    if (!titlePrice) return res.status(404).json({ error: 'Title price not found' });

    const pricing = await getPricing();
    const gatewayFee = pricing.GATEWAY_FEE || 1.00;
    const percent = pricing.TITLE_RENEWAL_PERCENT || 10;

    const finalPrice = approvedPrice !== undefined ? parseFloat(approvedPrice) : titlePrice.price;
    if (isNaN(finalPrice) || finalPrice <= 0) {
      return res.status(400).json({ error: 'Invalid approvedPrice' });
    }

    const renewalFee = Math.round(finalPrice * (percent / 100));

    const letters = request.handleName.replace(/[0-9]/g, '').replace(/_/g, '');
    const digits = request.handleName.replace(/[^0-9]/g, '');

    const transaction = await prisma.transaction.create({
      data: {
        type: 'TITLE_PURCHASE',
        status: 'PENDING',
        amountRM: finalPrice,
        userId: user.id,
        referralCode: user.referralCode || null,
        pendingData: {
          userId: user.id,
          titleRequestId: request.id,
          handleName: request.handleName,
          baseWord: letters,
          numberSuffix: digits || null,
          titlePrice: finalPrice,
          renewalFee,
          title: request.title,
        },
      },
    });

    const billData = new URLSearchParams({
      userSecretKey: process.env.TOYYIBPAY_SECRET_KEY,
      categoryCode: process.env.TOYYIBPAY_CATEGORY_CODE_VAULT,
      billName: 'LiveID Title Handle',
      billDescription: `Title handle: liveid.asia/${request.handleName}`,
      billPriceSetting: 1,
      billPayorInfo: 1,
      billAmount: Math.round((finalPrice + gatewayFee) * 100),
      billReturnUrl: `${process.env.FRONTEND_URL}/en/payment/success?transactionId=${transaction.id}`,
      billCallbackUrl: `${process.env.BACKEND_URL}/api/transactions/callback`,
      billExternalReferenceNo: transaction.id,
      billTo: user.genericId,
      billEmail: user.email,
      billPhone: user.phone,
      billSplitPayment: 0,
      billPaymentChannel: '2',
      billContentEmail: 'Thank you for claiming your LiveID Title handle.',
    });

    const toyyibResponse = await axios.post(
      'https://toyyibpay.com/index.php/api/createBill',
      billData.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const billCode = toyyibResponse.data?.[0]?.BillCode;
    if (!billCode) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'FAILED' },
      });
      return res.status(500).json({ error: 'Failed to create payment bill' });
    }

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { toyyibRef: billCode },
    });

    const paymentUrl = `https://toyyibpay.com/${billCode}`;

    const updated = await prisma.titleRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedPrice: finalPrice,
        renewalFee,
        adminNotes: adminNotes || null,
        reviewedAt: new Date(),
        toyyibRef: billCode,
      },
    });

    console.log('TITLE APPROVED | handle=%s | title=%s | price=RM%s | billcode=%s | req=%s',
      request.handleName, request.title, finalPrice, billCode, request.id);

    try {
      await resend.emails.send({
        from: 'LiveID <hello@awas.asia>',
        to: request.email,
        subject: `Verified — claim liveid.asia/${request.handleName}`,
        html: emailShell(`
          <h1 style="font-size: 1.4rem; margin: 0 0 8px;">Your title is verified.</h1>
          <p style="font-size: 1.2rem; font-weight: 700; color: #3b82f6; margin: 0 0 24px; font-family: monospace;">
            liveid.asia/${request.handleName}
          </p>
          <p style="font-size: 0.9rem; line-height: 1.7;">
            We checked your document against the awarding authority. It holds.
            The handle is yours once payment clears.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 24px 0;">
            <p style="font-size: 0.9rem; line-height: 1.9; margin: 0;">
              <strong>${titlePrice.label}</strong><br>
              One-time: <strong>RM${finalPrice}</strong><br>
              Annual renewal from next year: RM${renewalFee}
            </p>
          </div>
          <a href="${paymentUrl}"
            style="display: inline-block; margin: 8px 0 24px; padding: 14px 28px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
            Pay and claim my handle
          </a>
          <p style="font-size: 0.85rem; line-height: 1.7; color: #64748b;">
            This link is for you only. Your current handle
            ${user.genericId ? '' : ''}will be retired and replaced by your title handle when payment clears.
          </p>
        `),
      });
    } catch (e) {
      console.error('Approval email failed:', e.message);
    }

    res.json({
      message: 'Request approved and payment link sent',
      request: updated,
      paymentUrl,
      transactionId: transaction.id,
    });
  } catch (err) {
    console.error('approveTitleRequest error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// ADMIN — TITLE PRICES
// ============================================================

exports.listTitlePricesAdmin = async (req, res) => {
  try {
    const titles = await prisma.titlePrice.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json({ titles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addTitlePrice = async (req, res) => {
  try {
    const { title, label, price, renewalFee, sortOrder } = req.body;
    if (!title || !label || price === undefined) {
      return res.status(400).json({ error: 'title, label and price are required' });
    }

    const cleanTitle = title.trim().toLowerCase().replace(/[^a-z_']/g, '');
    if (!cleanTitle) return res.status(400).json({ error: 'Invalid title' });

    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) return res.status(400).json({ error: 'Invalid price' });

    const pricing = await getPricing();
    const percent = pricing.TITLE_RENEWAL_PERCENT || 10;
    const rf = renewalFee !== undefined ? parseFloat(renewalFee) : Math.round(p * (percent / 100));

    const created = await prisma.titlePrice.create({
      data: {
        title: cleanTitle,
        label: label.trim(),
        price: p,
        renewalFee: rf,
        requiresDoc: true,
        isActive: true,
        sortOrder: sortOrder ? parseInt(sortOrder) : 0,
      },
    });

    // A title price is useless unless the word is also blocked
    const blocked = await prisma.blockedWord.findUnique({ where: { word: cleanTitle } });
    if (!blocked) {
      await prisma.blockedWord.create({
        data: {
          word: cleanTitle,
          category: 'TITLE',
          reason: 'Conferred title — requires documentary proof',
        },
      });
    }

    res.status(201).json({ message: 'Title price added and word blocked', titlePrice: created });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'This title already exists' });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.updateTitlePrice = async (req, res) => {
  try {
    const { id } = req.params;
    const { price, renewalFee, isActive, label, sortOrder } = req.body;

    const data = {};
    if (price !== undefined) {
      const p = parseFloat(price);
      if (isNaN(p) || p <= 0) return res.status(400).json({ error: 'Invalid price' });
      data.price = p;
    }
    if (renewalFee !== undefined) {
      const rf = parseFloat(renewalFee);
      if (isNaN(rf) || rf < 0) return res.status(400).json({ error: 'Invalid renewalFee' });
      data.renewalFee = rf;
    }
    if (isActive !== undefined) data.isActive = !!isActive;
    if (label !== undefined) data.label = label.trim();
    if (sortOrder !== undefined) data.sortOrder = parseInt(sortOrder);

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const updated = await prisma.titlePrice.update({ where: { id }, data });
    res.json({ message: 'Title price updated', titlePrice: updated });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Title price not found' });
    }
    res.status(500).json({ error: err.message });
  }
};