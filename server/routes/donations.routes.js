const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getGatewaySettings, getRazorpayClient, verifySignature } = require('../utils/razorpay');
const { logActivity } = require('../utils/activityLog');
const { notifyDonationWhatsApp } = require('../utils/paymentNotify');

const router = express.Router();

const SELECT_JOIN = `
  SELECT d.*, m.name AS member_name, e.title AS event_title
  FROM donations d
  LEFT JOIN members m ON m.id = d.member_id
  LEFT JOIN events e ON e.id = d.event_id
`;

router.get('/', requireAuth, async (req, res) => {
  const rows = await db.prepare(`${SELECT_JOIN} ORDER BY d.donation_date DESC, d.created_at DESC, d.id DESC`).all();
  res.json(rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { member_id, donor_name, amount, donation_date, purpose, event_id } = req.body || {};
  if (amount === undefined || (!member_id && !donor_name)) {
    return res.status(400).json({ error: 'amount and either member_id or donor_name are required' });
  }
  const info = await db
    .prepare(
      `INSERT INTO donations (member_id, donor_name, amount, donation_date, purpose, event_id)
       VALUES (?, ?, ?, COALESCE(?, CURDATE()), ?, ?)`
    )
    .run(member_id || null, donor_name || null, amount, donation_date || null, purpose || null, event_id || null);
  const row = await db.prepare(`${SELECT_JOIN} WHERE d.id = ?`).get(info.lastInsertRowid);
  notifyDonationWhatsApp(row);
  logActivity({
    actor: req.user?.username,
    action: 'create',
    entityType: 'donation',
    entityId: row.id,
    description: `Added donation of ₹${row.amount} from ${row.donor_name || row.member_name || 'member'}`,
  });
  res.status(201).json(row);
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Donation not found' });
  const { member_id, donor_name, amount, donation_date, purpose, event_id } = req.body || {};
  await db.prepare(
    `UPDATE donations SET member_id = ?, donor_name = ?, amount = ?, donation_date = ?, purpose = ?, event_id = ?
     WHERE id = ?`
  ).run(
    member_id !== undefined ? member_id : existing.member_id,
    donor_name !== undefined ? donor_name : existing.donor_name,
    amount ?? existing.amount,
    donation_date ?? existing.donation_date,
    purpose ?? existing.purpose,
    event_id !== undefined ? event_id : existing.event_id,
    req.params.id
  );
  const row = await db.prepare(`${SELECT_JOIN} WHERE d.id = ?`).get(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'update',
    entityType: 'donation',
    entityId: row.id,
    description: `Updated donation of ₹${row.amount} from ${row.donor_name || row.member_name || 'member'}`,
  });
  res.json(row);
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Donation not found' });
  await db.prepare('DELETE FROM donations WHERE id = ?').run(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'delete',
    entityType: 'donation',
    entityId: existing.id,
    description: `Deleted donation of ₹${existing.amount} from ${existing.donor_name || 'member ID ' + existing.member_id}`,
  });
  res.json({ ok: true });
});

// A logged-in member starts a donation for themselves; it stays 'pending' until paid online or confirmed by an admin (UPI QR path)
router.post('/self', requireAuth, async (req, res) => {
  if (!req.user.member_id) {
    return res.status(400).json({ error: 'Your login isn\'t linked to a member profile, so this can\'t be recorded as your own donation.' });
  }
  const { amount, purpose, event_id } = req.body || {};
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'A valid amount is required' });
  }
  const info = await db
    .prepare(
      `INSERT INTO donations (member_id, amount, purpose, event_id, status, source)
       VALUES (?, ?, ?, ?, 'pending', 'member')`
    )
    .run(req.user.member_id, amount, purpose || null, event_id || null);
  const row = await db.prepare(`${SELECT_JOIN} WHERE d.id = ?`).get(info.lastInsertRowid);
  logActivity({
    actor: req.user?.username,
    action: 'create',
    entityType: 'donation',
    entityId: row.id,
    description: `Started self donation of ₹${row.amount} (pending payment)`,
  });
  res.status(201).json(row);
});

async function loadOwnDonation(donationId, user) {
  const donation = await db.prepare("SELECT * FROM donations WHERE id = ? AND source = 'member'").get(donationId);
  if (!donation) return { error: 404, message: 'Donation not found' };
  if (donation.member_id !== user.member_id) {
    return { error: 403, message: 'You can only pay your own donation' };
  }
  if (donation.status !== 'pending') {
    return { error: 400, message: 'This donation has already been completed' };
  }
  return { donation };
}

router.post('/self/:id/order', requireAuth, async (req, res) => {
  const client = await getRazorpayClient();
  if (!client) {
    return res.status(400).json({ error: 'Online payments are not configured yet. Ask an admin to set up Razorpay in Payment Settings.' });
  }
  const { donation, error, message } = await loadOwnDonation(req.params.id, req.user);
  if (error) return res.status(error).json({ error: message });

  const amountPaise = Math.round(Number(donation.amount) * 100);
  try {
    const order = await client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `donation_${donation.id}`,
      notes: { donation_id: String(donation.id), member_id: String(donation.member_id) },
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
    console.error('Razorpay order creation failed (self donation):', err.error || err.message || err);
    res.status(502).json({ error: 'Could not reach Razorpay to create the order. Check the API keys in Payment Settings.' });
  }
});

router.post('/self/:id/verify', requireAuth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }

  const settings = await getGatewaySettings();
  if (!settings.razorpay_key_secret) {
    return res.status(400).json({ error: 'Online payments are not configured' });
  }

  const { donation, error, message } = await loadOwnDonation(req.params.id, req.user);
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

  const row = await db.prepare(`${SELECT_JOIN} WHERE d.id = ?`).get(donation.id);
  notifyDonationWhatsApp(row);
  logActivity({
    actor: req.user?.username,
    action: 'update',
    entityType: 'donation',
    entityId: row.id,
    description: `Online payment verified for donation of ₹${row.amount} from ${row.donor_name || row.member_name || 'member'}`,
  });
  res.json({ ok: true, donation: row });
});

// Admin reconciliation for donations paid via UPI QR (no automatic verification), whether from a member or a public well-wisher
router.put('/:id/confirm', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Donation not found' });
  if (existing.status !== 'pending') {
    return res.status(400).json({ error: 'This donation is already completed' });
  }
  await db.prepare("UPDATE donations SET status = 'completed', donation_date = CURDATE() WHERE id = ?").run(req.params.id);
  const row = await db.prepare(`${SELECT_JOIN} WHERE d.id = ?`).get(req.params.id);
  notifyDonationWhatsApp(row);
  logActivity({
    actor: req.user?.username,
    action: 'update',
    entityType: 'donation',
    entityId: row.id,
    description: `Confirmed UPI donation of ₹${row.amount} from ${row.donor_name || row.member_name || 'member'}`,
  });
  res.json(row);
});

module.exports = router;
