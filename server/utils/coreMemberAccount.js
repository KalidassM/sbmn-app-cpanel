const bcrypt = require('bcryptjs');
const db = require('../db');
const { firstPhoneDigits } = require('./phone');
const { notifyMember, appName, signOff } = require('./memberNotify');
const { portalUrl } = require('./appUrl');

// Makes sure a Core Member has an 'admin'-role login account - used both right after a Core
// Member is added, and for bulk-catching up any Core Members added before this existed.
// - No login account yet: creates one (username = phone number, password = phone number +
//   "@core"), flagged to force a password change on first login.
// - Already has an account with a lower role ('member'): promotes it to 'admin' in place,
//   leaving their existing password untouched (they're already logging in with it).
// - Already 'admin'/'super_admin': nothing to do.
// Returns { action: 'created' | 'upgraded' | 'skipped', username?, reason? }.
async function ensureCoreMemberAccount(memberId) {
  const member = await db.prepare('SELECT id, name, phone FROM members WHERE id = ?').get(memberId);
  if (!member) return { action: 'skipped', reason: 'Member not found' };

  const existing = await db.prepare('SELECT id, role, username FROM users WHERE member_id = ?').get(memberId);
  if (existing) {
    if (['admin', 'super_admin'].includes(existing.role)) {
      return { action: 'skipped', reason: 'Already has an admin login account', username: existing.username };
    }
    await db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', existing.id);
    await notifyMember(
      member,
      `Hi ${member.name}, you've been made a Core Member of ${await appName()}. Your existing account (${existing.username}) now has admin access. Visit the portal: ${portalUrl()}\n\n${await signOff()}`
    );
    return { action: 'upgraded', username: existing.username };
  }

  const username = firstPhoneDigits(member.phone);
  if (!username) return { action: 'skipped', reason: 'No usable phone number on file' };

  const password = `${username}@core`;
  const hash = bcrypt.hashSync(password, 10);
  try {
    await db.prepare(
      `INSERT INTO users (username, password_hash, role, member_id, must_change_password) VALUES (?, ?, 'admin', ?, 1)`
    ).run(username, hash, memberId);
    await notifyMember(
      member,
      `Hi ${member.name}, you've been added as a Core Member of ${await appName()} with admin portal access. Username: ${username}, Password: ${password}. Please log in at ${portalUrl()} and change your password.\n\n${await signOff()}`
    );
    return { action: 'created', username };
  } catch (err) {
    return { action: 'skipped', reason: 'Username already exists (duplicate phone number)' };
  }
}

module.exports = { ensureCoreMemberAccount };
