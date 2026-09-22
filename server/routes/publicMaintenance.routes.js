const express = require('express');
const db = require('../db');
const { logActivity } = require('../utils/activityLog');
const { getGatewaySettings, getRazorpayClient, verifySignature } = require('../utils/razorpay');
const { buildUpiQr } = require('../utils/upiQr');
const { ensureDuesGenerated } = require('../utils/maintenanceDues');
const { notifyAdminOfPayment, notifyPaymentWhatsApp } = require('../utils/paymentNotify');

const router = express.Router();

// Dues from before this month are old arrears predating what should be collected through this
// public page - members with older pending dues pay those offline/through the admin instead.
const OLDEST_PAYABLE_YEAR = 2026;
const OLDEST_PAYABLE_MONTH = 6;

// An exact Site No match is unambiguous; otherwise fall back to a name search (min 3 chars, capped) to avoid scraping the member list
async function findMembers(query) {
  const q = (query || '').toString().trim();
  if (!q) return [];
  // No COLLATE NOCASE needed - the table's utf8mb4_general_ci collation is already case-insensitive.
  const bySiteNo = await db.prepare('SELECT id, name, site_no, status FROM members WHERE site_no = ?').get(q);
  if (bySiteNo) return [bySiteNo];
  if (q.length < 3) return [];
  return db.prepare('SELECT id, name, site_no, status FROM members WHERE name LIKE ? LIMIT 10').all(`%${q}%`);
}

router.get('/dues', async (req, res) => {
  const members = await findMembers(req.query.q);
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const activeMembers = members.filter((m) => m.status === 'active');
  if (activeMembers.length) {
    await ensureDuesGenerated(currentMonth, currentYear);
  }
  const results = [];
  for (const m of members) {
    if (m.status !== 'active') {
      // Inactive members can't pay online here - no dues are surfaced, just the member/site so
      // the client can show a plain "you're not an active member" message instead of a due list.
      results.push({ member_id: m.id, name: m.name, site_no: m.site_no, inactive: true, dues: [] });
      continue;
    }
    // Show the current month plus any missed past months (arrears) - never a future month's due,
    // and never anything older than OLDEST_PAYABLE_YEAR/MONTH (those arrears are handled outside
    // this public page).
    const dues = await db
      .prepare(
        `SELECT id, month, year, amount_due, amount_paid, status FROM maintenance_payments
         WHERE member_id = ? AND status != 'paid'
           AND (year > ? OR (year = ? AND month >= ?))
           AND (year < ? OR (year = ? AND month <= ?))
         ORDER BY year, month`
      )
      .all(m.id, OLDEST_PAYABLE_YEAR, OLDEST_PAYABLE_YEAR, OLDEST_PAYABLE_MONTH, currentYear, currentYear, currentMonth);
    results.push({ member_id: m.id, name: m.name, site_no: m.site_no, inactive: false, dues });
  }
  res.json(results);
});

const INACTIVE_MESSAGE = "You're not an active member, so this due can't be paid online. Please contact the association.";

async function loadPendingDue(dueId) {
  const due = await db.prepare('SELECT * FROM maintenance_payments WHERE id = ?').get(dueId);
  if (!due) return { error: 404, message: 'Due record not found' };
  if (due.status === 'paid') return { error: 400, message: 'This due is already fully paid' };
  const member = await db.prepare('SELECT status FROM members WHERE id = ?').get(due.member_id);
  if (member?.status !== 'active') return { error: 403, message: INACTIVE_MESSAGE };
  return { due };
}

// Loads and validates a set of due ids for a single combined payment - all must exist,
// belong to the same member, and still be outstanding.
async function loadPendingDues(ids) {
  if (!ids.length) return { error: 400, message: 'No dues specified' };
  const placeholders = ids.map(() => '?').join(',');
  const dues = await db.prepare(`SELECT * FROM maintenance_payments WHERE id IN (${placeholders})`).all(...ids);
  if (dues.length !== ids.length) return { error: 404, message: 'One or more due records not found' };
  if (dues.some((d) => d.status === 'paid')) return { error: 400, message: 'One or more dues are already fully paid' };
  const memberId = dues[0].member_id;
  if (dues.some((d) => d.member_id !== memberId)) return { error: 400, message: 'Dues must belong to the same member' };
  const member = await db.prepare('SELECT status FROM members WHERE id = ?').get(memberId);
  if (member?.status !== 'active') return { error: 403, message: INACTIVE_MESSAGE };
  return { dues };
}

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

// Combined payment across several unpaid months for one member - one Razorpay order/payment
// sized to the sum of all remaining amounts, which then marks every included month paid.
// Registered before the /:id/* routes below since ':id' would otherwise greedily match "pay-multiple".
router.post('/pay-multiple/order', async (req, res) => {
  const client = await getRazorpayClient();
  if (!client) {
    return res.status(400).json({ error: 'Online payments are not configured yet. Please use the UPI QR code instead.' });
  }
  const ids = Array.isArray(req.body?.dueIds) ? req.body.dueIds.map(Number).filter(Number.isInteger) : [];
  const { dues, error, message } = await loadPendingDues(ids);
  if (error) return res.status(error).json({ error: message });

  const remaining = dues.reduce((sum, d) => sum + (Number(d.amount_due) - Number(d.amount_paid)), 0);
  const amountPaise = Math.round(remaining * 100);
  try {
    const order = await client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `dues_${dues[0].member_id}_${Date.now()}`,
      notes: { maintenance_payment_ids: dues.map((d) => d.id).join(','), member_id: String(dues[0].member_id) },
    });
    const setOrderId = db.prepare('UPDATE maintenance_payments SET razorpay_order_id = ? WHERE id = ?');
    await db.transaction(async (rows) => {
      for (const d of rows) await setOrderId.run(order.id, d.id);
    })(dues);
    const settings = await getGatewaySettings();
    res.json({
      orderId: order.id,
      amount: amountPaise,
      currency: order.currency,
      keyId: settings.razorpay_key_id,
      payeeName: settings.payee_name || 'Sri Balamurugan Nagar Welfare Association',
    });
  } catch (err) {
    console.error('Razorpay order creation failed (public maintenance, multi):', err.error || err.message || err);
    res.status(502).json({ error: 'Could not reach Razorpay to create the order. Please try the UPI QR code instead.' });
  }
});

router.post('/pay-multiple/verify', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, dueIds } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }

  const settings = await getGatewaySettings();
  if (!settings.razorpay_key_secret) {
    return res.status(400).json({ error: 'Online payments are not configured' });
  }

  const ids = Array.isArray(dueIds) ? dueIds.map(Number).filter(Number.isInteger) : [];
  const { dues, error, message } = await loadPendingDues(ids);
  if (error) return res.status(error).json({ error: message });

  if (!dues.every((d) => d.razorpay_order_id === razorpay_order_id)) {
    return res.status(400).json({ error: 'Order does not match these dues' });
  }
  if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, settings.razorpay_key_secret)) {
    return res.status(400).json({ error: 'Payment signature verification failed' });
  }

  const markPaid = db.prepare(
    `UPDATE maintenance_payments
     SET amount_paid = amount_due, status = 'paid', paid_date = CURDATE(), paid_at = NOW(), razorpay_payment_id = ?,
         payment_mode = 'Razorpay', reference_no = ?
     WHERE id = ?`
  );
  await db.transaction(async (rows) => {
    for (const d of rows) await markPaid.run(razorpay_payment_id, razorpay_payment_id, d.id);
  })(dues);

  const updatedDues = [];
  for (const d of dues) updatedDues.push(await db.prepare('SELECT * FROM maintenance_payments WHERE id = ?').get(d.id));
  updatedDues.forEach((updated) => notifyAdminOfPayment(updated));
  notifyPaymentWhatsApp(updatedDues);
  const member = await db.prepare('SELECT name, site_no FROM members WHERE id = ?').get(dues[0].member_id);
  const total = dues.reduce((sum, d) => sum + (Number(d.amount_due) - Number(d.amount_paid)), 0);
  const months = dues.map((d) => `${d.month}/${d.year}`).join(', ');
  logActivity({
    actor: 'public',
    action: 'payment',
    entityType: 'maintenance_payment',
    description: `${member?.name || 'Member'} (Site No ${member?.site_no || '-'}) paid ₹${total} online for ${dues.length} month(s): ${months} (due ids: ${dues.map((d) => d.id).join(', ')})`,
  });
  res.json({ ok: true });
});

router.post('/:id/order', async (req, res) => {
  const client = await getRazorpayClient();
  if (!client) {
    return res.status(400).json({ error: 'Online payments are not configured yet. Please use the UPI QR code instead.' });
  }
  const { due, error, message } = await loadPendingDue(req.params.id);
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
    console.error('Razorpay order creation failed (public maintenance):', err.error || err.message || err);
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

  const { due, error, message } = await loadPendingDue(req.params.id);
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
    actor: 'public',
    action: 'payment',
    entityType: 'maintenance_payment',
    entityId: updated.id,
    description: `${member?.name || 'Member'} (Site No ${member?.site_no || '-'}) paid ₹${updated.amount_paid} online for ${updated.month}/${updated.year}`,
  });
  res.json({ ok: true });
});

module.exports = router;
