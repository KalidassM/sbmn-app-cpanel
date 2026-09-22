const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const whatsapp = require('../utils/whatsappClient');
const { signOff } = require('../utils/memberNotify');

const router = express.Router();

// Read by the General Settings page - there's no QR/session to poll here (Cloud API is
// credential-based, not a linked device), just whether WHATSAPP_ACCESS_TOKEN /
// WHATSAPP_PHONE_NUMBER_ID are set on the server.
router.get('/status', requireAuth, requireAdmin, (req, res) => {
  res.json({ status: whatsapp.getStatus() });
});

// Sends a single one-off message to a phone number of the admin's choosing - lets them confirm
// delivery actually works before the automatic monthly-dues reminder ever touches real members.
// Note: this uses a freeform text message, which Meta only delivers if that phone number has
// messaged this WhatsApp Business number within the last 24 hours (see whatsappClient.js).
router.post('/test', requireAuth, requireAdmin, async (req, res) => {
  const phone = (req.body?.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'Enter a phone number' });
  try {
    await whatsapp.sendMessage(phone, `This is a test message from your SBMN app. If you received this, WhatsApp is configured correctly.\n\n${signOff()}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
