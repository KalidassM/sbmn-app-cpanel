const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');
const { ensureCoreMemberAccount } = require('../utils/coreMemberAccount');

const router = express.Router();

const SELECT_JOIN = `
  SELECT cm.*, m.name AS member_name, m.phone AS member_phone, m.email AS member_email
  FROM core_members cm
  JOIN members m ON m.id = cm.member_id
`;

router.get('/', requireAuth, async (req, res) => {
  const rows = await db.prepare(`${SELECT_JOIN} ORDER BY cm.end_date IS NOT NULL, cm.start_date DESC`).all();
  res.json(rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { member_id, designation, start_date, end_date, notes, photo } = req.body || {};
  if (!member_id || !designation) {
    return res.status(400).json({ error: 'member_id and designation are required' });
  }
  const member = await db.prepare('SELECT * FROM members WHERE id = ?').get(member_id);
  if (!member) return res.status(400).json({ error: 'Member does not exist' });
  const info = await db
    .prepare(
      `INSERT INTO core_members (member_id, designation, start_date, end_date, notes, photo)
       VALUES (?, ?, COALESCE(?, CURDATE()), ?, ?, ?)`
    )
    .run(member_id, designation, start_date || null, end_date || null, notes || null, photo || null);
  const row = await db.prepare(`${SELECT_JOIN} WHERE cm.id = ?`).get(info.lastInsertRowid);
  logActivity({
    actor: req.user?.username,
    action: 'create',
    entityType: 'core_member',
    entityId: row.id,
    description: `Added core member ${row.member_name} as ${row.designation}`,
  });

  const account = await ensureCoreMemberAccount(member_id);
  if (account.action === 'created' || account.action === 'upgraded') {
    logActivity({
      actor: req.user?.username,
      action: 'update',
      entityType: 'user',
      description:
        account.action === 'created'
          ? `Created admin login account ${account.username} for core member ${row.member_name}`
          : `Upgraded login account ${account.username} to admin for core member ${row.member_name}`,
    });
  }

  res.status(201).json({ ...row, account });
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM core_members WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Core member record not found' });
  const { designation, start_date, end_date, notes, photo } = req.body || {};
  await db.prepare(
    `UPDATE core_members SET designation = ?, start_date = ?, end_date = ?, notes = ?, photo = ? WHERE id = ?`
  ).run(
    designation ?? existing.designation,
    start_date ?? existing.start_date,
    end_date !== undefined ? end_date : existing.end_date,
    notes ?? existing.notes,
    photo !== undefined ? photo : existing.photo,
    req.params.id
  );
  const row = await db.prepare(`${SELECT_JOIN} WHERE cm.id = ?`).get(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'update',
    entityType: 'core_member',
    entityId: row.id,
    description: `Updated core member ${row.member_name} (${row.designation})`,
  });
  res.json(row);
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare(`${SELECT_JOIN} WHERE cm.id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Core member record not found' });
  await db.prepare('DELETE FROM core_members WHERE id = ?').run(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'delete',
    entityType: 'core_member',
    entityId: existing.id,
    description: `Removed core member ${existing.member_name} (${existing.designation})`,
  });
  res.json({ ok: true });
});

module.exports = router;
