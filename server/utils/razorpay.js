const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('../db');

async function getGatewaySettings() {
  return db.prepare('SELECT razorpay_key_id, razorpay_key_secret, payee_name FROM payment_settings WHERE id = 1').get();
}

async function getRazorpayClient() {
  const settings = await getGatewaySettings();
  if (!settings.razorpay_key_id || !settings.razorpay_key_secret) return null;
  return new Razorpay({ key_id: settings.razorpay_key_id, key_secret: settings.razorpay_key_secret });
}

function verifySignature(orderId, paymentId, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return expected === signature;
}

module.exports = { getGatewaySettings, getRazorpayClient, verifySignature };
