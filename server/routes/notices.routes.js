const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const notices = await db.prepare('SELECT * FROM notices ORDER BY pinned DESC, created_at DESC').all();
  res.json(notices);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { title, body, pinned } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ error: 'title and body are required' });
  }
  const info = await db
    .prepare('INSERT INTO notices (title, body, pinned) VALUES (?, ?, ?)')
    .run(title.trim().slice(0, 80), body.trim().slice(0, 400), pinned ? 1 : 0);
  const row = await db.prepare('SELECT * FROM notices WHERE id = ?').get(info.lastInsertRowid);
  logActivity({
    actor: req.user?.username,
    action: 'create',
    entityType: 'notice',
    entityId: row.id,
    description: `Added notice ${row.title}`,
  });
  res.status(201).json(row);
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM notices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Notice not found' });
  const { title, body, pinned } = req.body || {};
  await db.prepare('UPDATE notices SET title = ?, body = ?, pinned = ? WHERE id = ?').run(
    title !== undefined ? title.trim().slice(0, 80) : existing.title,
    body !== undefined ? body.trim().slice(0, 400) : existing.body,
    pinned !== undefined ? (pinned ? 1 : 0) : existing.pinned,
    req.params.id
  );
  const row = await db.prepare('SELECT * FROM notices WHERE id = ?').get(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'update',
    entityType: 'notice',
    entityId: row.id,
    description: `Updated notice ${row.title}`,
  });
  res.json(row);
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM notices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Notice not found' });
  await db.prepare('DELETE FROM notices WHERE id = ?').run(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'delete',
    entityType: 'notice',
    entityId: existing.id,
    description: `Deleted notice ${existing.title}`,
  });
  res.json({ ok: true });
});

module.exports = router;
