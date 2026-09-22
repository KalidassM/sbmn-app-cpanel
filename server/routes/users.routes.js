const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');
const { firstPhoneDigits } = require('../utils/phone');
const { ensureCoreMemberAccount } = require('../utils/coreMemberAccount');
const { notifyMember, appName, signOff } = require('../utils/memberNotify');
const { portalUrl } = require('../utils/appUrl');

// A newly-created account's WhatsApp number: the linked member's phone, or - for accounts not
// linked to a member - the username itself if it looks like a phone number, matching the
// "username = phone number" convention used everywhere else in this app.
function resolveAccountPhone(username, member) {
  if (member?.phone) return member.phone;
  return /^\d{10}$/.test(username) ? username : null;
}

const router = express.Router();

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT u.id, u.username, u.role, u.member_id, m.name AS member_name, u.created_at, u.must_change_password, u.last_login_at
       FROM users u LEFT JOIN members m ON m.id = u.member_id ORDER BY u.username`
    )
    .all();
  res.json(rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role, member_id } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
  if (role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a Super Admin can create another Super Admin account' });
  }
  const finalRole = ['admin', 'super_admin'].includes(role) ? role : 'member';
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = await db
      .prepare('INSERT INTO users (username, password_hash, role, member_id, must_change_password) VALUES (?, ?, ?, ?, 1)')
      .run(username, hash, finalRole, member_id || null);
    const row = await db.prepare('SELECT id, username, role, member_id FROM users WHERE id = ?').get(info.lastInsertRowid);
    logActivity({
      actor: req.user?.username,
      action: 'create',
      entityType: 'user',
      entityId: row.id,
      description: `Created user ${row.username} (role: ${row.role})`,
    });

    const member = row.member_id ? await db.prepare('SELECT name, phone FROM members WHERE id = ?').get(row.member_id) : null;
    const phone = resolveAccountPhone(row.username, member);
    if (phone) {
      const name = member?.name || row.username;
      notifyMember(
        { phone },
        `Hi ${name}, your login account for ${await appName()} has been created. Username: ${row.username}, Password: ${password}. Please log in at ${portalUrl()} and change your password.\n\n${await signOff()}`
      );
    }

    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

// Creates a login account (role 'member') for every active member who doesn't already have one,
// using their phone number as both the username and the initial password (with "@123" appended).
// Flags the account so the forced-change-password flow kicks in on first login. Safe to re-run -
// members who already have a linked login are skipped, not duplicated.
router.post('/bulk-create-for-members', requireAuth, requireSuperAdmin, async (req, res) => {
  const members = await db.prepare("SELECT id, name, phone FROM members WHERE status = 'active'").all();
  const findExistingLogin = db.prepare('SELECT id FROM users WHERE member_id = ?');
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, role, member_id, must_change_password) VALUES (?, ?, 'member', ?, 1)`
  );

  let created = 0;
  const createdAccounts = [];
  const skipped = [];

  await db.transaction(async (rows) => {
    for (const m of rows) {
      if (await findExistingLogin.get(m.id)) {
        skipped.push({ member_id: m.id, name: m.name, reason: 'Already has a login account' });
        continue;
      }
      const username = firstPhoneDigits(m.phone);
      if (!username) {
        skipped.push({ member_id: m.id, name: m.name, reason: 'No usable phone number on file' });
        continue;
      }
      const password = `${username}@123`;
      const hash = bcrypt.hashSync(password, 10);
      try {
        await insertUser.run(username, hash, m.id);
        created++;
        createdAccounts.push({ member_id: m.id, name: m.name, username });
      } catch (err) {
        skipped.push({ member_id: m.id, name: m.name, reason: 'Username already exists (duplicate phone number)' });
      }
    }
  })(members);

  logActivity({
    actor: req.user?.username,
    action: 'bulk_upload',
    entityType: 'user',
    description: `Bulk-created ${created} member login account(s); ${skipped.length} skipped`,
  });
  res.json({ created, createdAccounts, skipped });
});

// Catches up any Core Member assigned before the auto-account flow existed (or whose account
// creation was skipped at the time) - creates/upgrades an 'admin'-role login for every currently
// active core member (end_date not set), via the same ensureCoreMemberAccount used on assignment.
router.post('/bulk-create-for-core-members', requireAuth, requireSuperAdmin, async (req, res) => {
  const coreMembers = await db
    .prepare(
      `SELECT cm.member_id, m.name FROM core_members cm JOIN members m ON m.id = cm.member_id WHERE cm.end_date IS NULL`
    )
    .all();

  let created = 0;
  let upgraded = 0;
  const createdAccounts = [];
  const skipped = [];

  for (const cm of coreMembers) {
    const result = await ensureCoreMemberAccount(cm.member_id);
    if (result.action === 'created') {
      created++;
      createdAccounts.push({ member_id: cm.member_id, name: cm.name, username: result.username });
    } else if (result.action === 'upgraded') {
      upgraded++;
      createdAccounts.push({ member_id: cm.member_id, name: cm.name, username: result.username });
    } else {
      skipped.push({ member_id: cm.member_id, name: cm.name, reason: result.reason });
    }
  }

  logActivity({
    actor: req.user?.username,
    action: 'bulk_upload',
    entityType: 'user',
    description: `Bulk-created ${created} and upgraded ${upgraded} core member admin login account(s); ${skipped.length} skipped`,
  });
  res.json({ created, upgraded, createdAccounts, skipped });
});

router.put('/:id/reset-password', requireAuth, requireSuperAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password is required' });
  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const hash = bcrypt.hashSync(password, 10);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'update',
    entityType: 'user',
    entityId: existing.id,
    description: `Reset password for user ${existing.username}`,
  });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (existing.username === 'admin') return res.status(400).json({ error: 'Cannot delete the default admin account' });
  await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'delete',
    entityType: 'user',
    entityId: existing.id,
    description: `Deleted user ${existing.username} (role: ${existing.role})`,
  });
  res.json({ ok: true });
});

module.exports = router;
