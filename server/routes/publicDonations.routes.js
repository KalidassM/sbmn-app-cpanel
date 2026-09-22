const express = require('express');
const db = require('../db');
const { logActivity } = require('../utils/activityLog');
const { notifyDonationWhatsApp } = require('../utils/paymentNotify');
const { getGatewaySettings, getRazorpayClient, verifySignature } = require('../utils/razorpay');
const { buildUpiQr } = require('../utils/upiQr');

const router = express.Router();

const MAX_AMOUNT = 1000000;

async function loadPendingPublicDonation(donationId) {
  const donation = await db.prepare("SELECT * FROM donations WHERE id = ? AND source = 'public'").get(donationId);
  if (!donation) return { error: 404, message: 'Donation not found' };
  if (donation.status !== 'pending') {
    return { error: 400, message: 'This donation has already been completed' };
  }
  return { donation };
}

// No requireAuth on this router — well-wishers have no account. Only exposes what's needed to record and pay a donation.
router.post('/', async (req, res) => {
  const { donor_name, donor_email, donor_phone, amount, purpose } = req.body || {};
  const name = (donor_name || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'Your name is required' });
  if (!amount || Number(amount) <= 0 || Number(amount) > MAX_AMOUNT) {
    return res.status(400).json({ error: 'A valid amount is required' });
  }
  const info = await db
    .prepare(
      `INSERT INTO donations (donor_name, donor_email, donor_phone, amount, purpose, status, source)
       VALUES (?, ?, ?, ?, ?, 'pending', 'public')`
    )
    .run(name.slice(0, 120), (donor_email || '').toString().trim().slice(0, 160) || null, (donor_phone || '').toString().trim().slice(0, 32) || null, amount, (purpose || '').toString().trim().slice(0, 200) || null);
  logActivity({
    actor: 'public',
    action: 'create',
    entityType: 'donation',
    entityId: info.lastInsertRowid,
    description: `${name} pledged a donation of ₹${Number(amount)}${purpose ? ` for ${purpose}` : ''}`,
  });
  res.status(201).json({ id: info.lastInsertRowid, donor_name: name, amount: Number(amount) });
});

router.get('/razorpay-config', async (req, res) => {
  const settings = await getGatewaySettings();
  res.json({
    configured: !!(settings.razorpay_key_id && settings.razorpay_key_secret),
    keyId: settings.razorpay_key_id || null,
  });
});

router.get('/qr', async (req, res) => {
  try {
    const result = await buildUpiQr(Number(req.query.amount), req.query.note);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/order', async (req, res) => {
  const client = await getRazorpayClient();
  if (!client) {
    return res.status(400).json({ error: 'Online payments are not configured yet. Please use the UPI QR code instead.' });
  }
  const { donation, error, message } = await loadPendingPublicDonation(req.params.id);
  if (error) return res.status(error).json({ error: message });

  const amountPaise = Math.round(Number(donation.amount) * 100);
  try {
    const order = await client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `donation_${donation.id}`,
      notes: { donation_id: String(donation.id), donor_name: donation.donor_name || '' },
    });
    await db.prepare('UPDATE donations SET razorpay_order_id = ? WHERE id = ?').run(order.id, donation.id);
    const settings = await getGatewaySettings();
    res.json({
      orderId: order.id,
      amount: amountPaise,
      currency: order.currency,
      keyId: settings.razorpay_key_id,
      payeeName: settings.payee_name || 'Sri Balamurugan Nagar Welfare Association',
    });
  } catch (err) {
    console.error('Razorpay order creation failed (public donation):', err.error || err.message || err);
    res.status(502).json({ error: 'Could not reach Razorpay to create the order. Please try the UPI QR code instead.' });
  }
});

router.post('/:id/verify', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }

  const settings = await getGatewaySettings();
  if (!settings.razorpay_key_secret) {
    return res.status(400).json({ error: 'Online payments are not configured' });
  }

  const { donation, error, message } = await loadPendingPublicDonation(req.params.id);
  if (error) return res.status(error).json({ error: message });

  if (donation.razorpay_order_id !== razorpay_order_id) {
    return res.status(400).json({ error: 'Order does not match this donation' });
  }
  if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, settings.razorpay_key_secret)) {
    return res.status(400).json({ error: 'Payment signature verification failed' });
  }

  await db.prepare(
    `UPDATE donations SET status = 'completed', razorpay_payment_id = ?, donation_date = CURDATE() WHERE id = ?`
  ).run(razorpay_payment_id, donation.id);

  notifyDonationWhatsApp(donation);
  logActivity({
    actor: 'public',
    action: 'payment',
    entityType: 'donation',
    entityId: donation.id,
    description: `${donation.donor_name} paid ₹${donation.amount} donation online${donation.purpose ? ` for ${donation.purpose}` : ''}`,
  });
  res.json({ ok: true });
});

module.exports = router;
