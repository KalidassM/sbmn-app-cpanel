const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const whatsapp = require('../utils/whatsappClient');
const { logActivity } = require('../utils/activityLog');
const { signOff } = require('../utils/memberNotify');

const RESET_CODE_TTL_MINUTES = 15;

const router = express.Router();

// Formats using local time getters (not toISOString(), which is UTC) so that reparsing this same
// string back into `new Date(...)` later (see reset-password below) reconstructs the exact wall-
// clock instant that was intended, regardless of the server's timezone - MySQL DATETIME strings
// carry no timezone info, and V8 parses a space-separated "YYYY-MM-DD HH:MM:SS" string as local
// time, so both ends of the round trip need to agree on that same local interpretation.
function toMysqlDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  await db.prepare("UPDATE users SET last_login_at = NOW() WHERE id = ?").run(user.id);
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, member_id: user.member_id, must_change_password: !!user.must_change_password },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, member_id: user.member_id, must_change_password: !!user.must_change_password },
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);
  logActivity({
    actor: user.username,
    action: 'update',
    entityType: 'user',
    entityId: user.id,
    description: `${user.username} changed their own password`,
  });

  // Issue a fresh token/user so the client can clear the forced-change-password state without
  // having to log in again - the old token's must_change_password claim would otherwise stick
  // around until it naturally expires.
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, member_id: user.member_id, must_change_password: false },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({
    ok: true,
    token,
    user: { id: user.id, username: user.username, role: user.role, member_id: user.member_id, must_change_password: false },
  });
});

// A user's WhatsApp number for the reset code: their linked member's phone, or - for accounts
// created without a member link (e.g. the default admin) - the username itself if it looks like
// a phone number, matching the "username = phone number" convention used for bulk-created accounts.
async function resolveResetPhone(user) {
  if (user.member_id) {
    const member = await db.prepare('SELECT phone FROM members WHERE id = ?').get(user.member_id);
    if (member?.phone) return member.phone;
  }
  return /^\d{10}$/.test(user.username) ? user.username : null;
}

router.post('/forgot-password', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Username is required' });

  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'No account found with that username' });

  const phone = await resolveResetPhone(user);
  if (!phone) return res.status(400).json({ error: 'No phone number on file for this account. Contact an administrator.' });

  if (!whatsapp.isConnected()) {
    return res.status(503).json({ error: 'WhatsApp is not configured right now. Please contact an administrator.' });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = bcrypt.hashSync(code, 10);
  const expiresAt = toMysqlDateTime(new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000));
  await db.prepare('UPDATE users SET reset_code_hash = ?, reset_code_expires_at = ? WHERE id = ?').run(codeHash, expiresAt, user.id);

  const settings = await db.prepare('SELECT app_name FROM general_settings WHERE id = 1').get();
  const appName = settings?.app_name || 'the Association';
  const text = `Your password reset code for ${appName} portal is: ${code}. It expires in ${RESET_CODE_TTL_MINUTES} minutes. If you did not request this, please ignore this message.\n\n${await signOff()}`;

  whatsapp
    .sendMessage(phone, text)
    .then(() => res.json({ ok: true }))
    .catch((err) => {
      console.error('Forgot-password WhatsApp send failed:', err.message);
      res.status(500).json({ error: 'Could not send the reset code over WhatsApp. Please try again or contact an administrator.' });
    });
});

router.post('/reset-password', async (req, res) => {
  const { username, code, newPassword } = req.body || {};
  if (!username || !code || !newPassword) {
    return res.status(400).json({ error: 'Username, code and new password are required' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.reset_code_hash) return res.status(400).json({ error: 'Invalid or expired code' });
  if (!user.reset_code_expires_at || new Date(user.reset_code_expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
  }
  if (!bcrypt.compareSync(String(code), user.reset_code_hash)) {
    return res.status(400).json({ error: 'Invalid or expired code' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await db.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = 0, reset_code_hash = NULL, reset_code_expires_at = NULL WHERE id = ?'
  ).run(hash, user.id);
  logActivity({
    actor: user.username,
    action: 'update',
    entityType: 'user',
    entityId: user.id,
    description: `${user.username} reset their password via forgot-password`,
  });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, member_id: user.member_id, must_change_password: false },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({
    ok: true,
    token,
    user: { id: user.id, username: user.username, role: user.role, member_id: user.member_id, must_change_password: false },
  });
});

module.exports = router;
