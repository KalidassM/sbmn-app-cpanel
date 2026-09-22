const express = require('express');
const db = require('../db');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { buildUpiQr } = require('../utils/upiQr');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

// razorpay_key_secret must never leave the server — only expose the publishable key_id
function toPublicSettings(row) {
  const { razorpay_key_secret, ...safe } = row;
  return { ...safe, razorpay_configured: !!(row.razorpay_key_id && razorpay_key_secret) };
}

router.get('/', requireAuth, requireSuperAdmin, async (req, res) => {
  const row = await db.prepare('SELECT * FROM payment_settings WHERE id = 1').get();
  res.json(toPublicSettings(row));
});

router.put('/', requireAuth, requireSuperAdmin, async (req, res) => {
  const { upi_id, payee_name, bank_name, account_no, ifsc_code, razorpay_key_id, razorpay_key_secret } = req.body || {};
  const existing = await db.prepare('SELECT * FROM payment_settings WHERE id = 1').get();
  await db.prepare(
    `UPDATE payment_settings
     SET upi_id = ?, payee_name = ?, bank_name = ?, account_no = ?, ifsc_code = ?,
         razorpay_key_id = ?, razorpay_key_secret = ?, updated_at = NOW()
     WHERE id = 1`
  ).run(
    // each field falls back to its existing value when omitted, so partial saves (e.g. the gateway-keys
    // form, which doesn't send upi_id/bank fields) don't blank out settings saved from another form
    upi_id !== undefined ? upi_id || null : existing.upi_id,
    payee_name !== undefined ? payee_name || null : existing.payee_name,
    bank_name !== undefined ? bank_name || null : existing.bank_name,
    account_no !== undefined ? account_no || null : existing.account_no,
    ifsc_code !== undefined ? ifsc_code || null : existing.ifsc_code,
    razorpay_key_id !== undefined ? razorpay_key_id || null : existing.razorpay_key_id,
    // blank/omitted secret keeps the existing one, so admins don't have to re-enter it every save
    razorpay_key_secret ? razorpay_key_secret : existing.razorpay_key_secret
  );
  const row = await db.prepare('SELECT * FROM payment_settings WHERE id = 1').get();
  logActivity({
    actor: req.user?.username,
    action: 'update',
    entityType: 'payment_settings',
    description: 'Updated payment settings',
  });
  res.json(toPublicSettings(row));
});

// Builds a UPI deep link for the configured account and renders it as a scannable QR code
router.get('/qr', requireAuth, async (req, res) => {
  try {
    const result = await buildUpiQr(Number(req.query.amount), req.query.note);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
