const QRCode = require('qrcode');
const db = require('../db');

async function buildUpiQr(amount, note) {
  const settings = await db.prepare('SELECT upi_id, payee_name FROM payment_settings WHERE id = 1').get();
  if (!settings || !settings.upi_id) {
    throw new Error('UPI ID has not been configured yet. Ask an admin to set it up in Payment Settings.');
  }
  if (!amount || amount <= 0) {
    throw new Error('A valid amount is required');
  }

  const params = new URLSearchParams({
    pa: settings.upi_id,
    pn: settings.payee_name || 'Sri Balamurugan Nagar Welfare Association',
    am: amount.toFixed(2),
    cu: 'INR',
    tn: (note || 'Association payment').toString().slice(0, 60),
  });
  const upiUri = `upi://pay?${params.toString()}`;
  const qrDataUrl = await QRCode.toDataURL(upiUri, { width: 260, margin: 1 });
  return { upiUri, qrDataUrl };
}

module.exports = { buildUpiQr };
