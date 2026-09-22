const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const events = await db.prepare('SELECT * FROM events ORDER BY event_date DESC').all();
  res.json(events);
});

router.get('/:id', requireAuth, async (req, res) => {
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const expenses = await db.prepare('SELECT * FROM expenses WHERE event_id = ? ORDER BY expense_date').all(req.params.id);
  const donations = await db.prepare('SELECT * FROM donations WHERE event_id = ? ORDER BY donation_date').all(req.params.id);
  res.json({ ...event, expenses, donations });
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { title, description, event_date, venue } = req.body || {};
  if (!title || !event_date) {
    return res.status(400).json({ error: 'title and event_date are required' });
  }
  const info = await db
    .prepare(
      `INSERT INTO events (title, description, event_date, venue)
       VALUES (?, ?, ?, ?)`
    )
    .run(title, description || null, event_date, venue || null);
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  logActivity({
    actor: req.user?.username,
    action: 'create',
    entityType: 'event',
    entityId: event.id,
    description: `Added event ${event.title} (${event.event_date})`,
  });
  res.status(201).json(event);
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  const { title, description, event_date, venue } = req.body || {};
  await db.prepare(
    `UPDATE events SET title = ?, description = ?, event_date = ?, venue = ? WHERE id = ?`
  ).run(
    title ?? existing.title,
    description ?? existing.description,
    event_date ?? existing.event_date,
    venue ?? existing.venue,
    req.params.id
  );
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'update',
    entityType: 'event',
    entityId: event.id,
    description: `Updated event ${event.title} (${event.event_date})`,
  });
  res.json(event);
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  await db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'delete',
    entityType: 'event',
    entityId: existing.id,
    description: `Deleted event ${existing.title} (${existing.event_date})`,
  });
  res.json({ ok: true });
});

module.exports = router;
