const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');
const { getGatewaySettings, getRazorpayClient, verifySignature } = require('../utils/razorpay');
const { notifyAdminOfPayment, notifyPaymentWhatsApp } = require('../utils/paymentNotify');

const router = express.Router();

async function loadDue(paymentId, user) {
  const due = await db.prepare('SELECT * FROM maintenance_payments WHERE id = ?').get(paymentId);
  if (!due) return { error: 404, message: 'Due record not found' };
  if (!['admin', 'super_admin'].includes(user.role) && due.member_id !== user.member_id) {
    return { error: 403, message: 'You can only pay your own dues' };
  }
  if (due.status === 'paid') {
    return { error: 400, message: 'This due is already fully paid' };
  }
  return { due };
}

router.get('/config', requireAuth, async (req, res) => {
  const settings = await getGatewaySettings();
  res.json({
    configured: !!(settings.razorpay_key_id && settings.razorpay_key_secret),
    keyId: settings.razorpay_key_id || null,
  });
});

router.post('/order', requireAuth, async (req, res) => {
  const { payment_id } = req.body || {};
  if (!payment_id) return res.status(400).json({ error: 'payment_id is required' });

  const client = await getRazorpayClient();
  if (!client) {
    return res.status(400).json({ error: 'Online payments are not configured yet. Ask an admin to set up Razorpay in Payment Settings.' });
  }

  const { due, error, message } = await loadDue(payment_id, req.user);
  if (error) return res.status(error).json({ error: message });

  const remaining = Number(due.amount_due) - Number(due.amount_paid);
  const amountPaise = Math.round(remaining * 100);

  try {
    const order = await client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `due_${due.id}`,
      notes: { maintenance_payment_id: String(due.id), member_id: String(due.member_id) },
    });
    await db.prepare('UPDATE maintenance_payments SET razorpay_order_id = ? WHERE id = ?').run(order.id, due.id);
    const settings = await getGatewaySettings();
    res.json({
      orderId: order.id,
      amount: amountPaise,
      currency: order.currency,
      keyId: settings.razorpay_key_id,
      payeeName: settings.payee_name || 'Sri Balamurugan Nagar Welfare Association',
    });
  } catch (err) {
    console.error('Razorpay order creation failed (maintenance due):', err.error || err.message || err);
    res.status(502).json({ error: 'Could not reach Razorpay to create the order. Check the API keys in Payment Settings.' });
  }
});

router.post('/verify', requireAuth, async (req, res) => {
  const { payment_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!payment_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }

  const settings = await getGatewaySettings();
  if (!settings.razorpay_key_secret) {
    return res.status(400).json({ error: 'Online payments are not configured' });
  }

  const { due, error, message } = await loadDue(payment_id, req.user);
  if (error) return res.status(error).json({ error: message });

  if (due.razorpay_order_id !== razorpay_order_id) {
    return res.status(400).json({ error: 'Order does not match this due' });
  }

  if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, settings.razorpay_key_secret)) {
    return res.status(400).json({ error: 'Payment signature verification failed' });
  }

  await db.prepare(
    `UPDATE maintenance_payments
     SET amount_paid = amount_due, status = 'paid', paid_date = CURDATE(), paid_at = NOW(), razorpay_payment_id = ?,
         payment_mode = 'Razorpay', reference_no = ?
     WHERE id = ?`
  ).run(razorpay_payment_id, razorpay_payment_id, due.id);

  const updated = await db.prepare('SELECT * FROM maintenance_payments WHERE id = ?').get(due.id);
  notifyAdminOfPayment(updated);
  notifyPaymentWhatsApp([updated]);
  const member = await db.prepare('SELECT name, site_no FROM members WHERE id = ?').get(updated.member_id);
  logActivity({
    actor: req.user?.username,
    action: 'payment',
    entityType: 'maintenance_payment',
    entityId: updated.id,
    description: `${member?.name || 'Member'} (Site No ${member?.site_no || '-'}) paid ₹${updated.amount_paid} online for ${updated.month}/${updated.year}`,
  });
  res.json({ ok: true, payment: updated });
});

module.exports = router;
