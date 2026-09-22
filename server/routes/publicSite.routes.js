const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/summary', async (req, res) => {
  const householdCount = (await db.prepare("SELECT COUNT(*) AS c FROM members WHERE status = 'active'").get()).c;
  const activeNotices = (await db.prepare('SELECT COUNT(*) AS c FROM notices').get()).c;
  const upcomingEvents = (await db.prepare("SELECT COUNT(*) AS c FROM events WHERE event_date >= CURDATE()").get()).c;
  res.json({ householdCount, activeNotices, upcomingEvents });
});

// Non-secret association profile fields (name/contact/address) for the public site to display
router.get('/profile', async (req, res) => {
  const row = await db
    .prepare('SELECT app_name, contact_email, office_address, office_hours, phone_number FROM general_settings WHERE id = 1')
    .get();
  res.json(row || {});
});

router.get('/notices', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM notices ORDER BY pinned DESC, created_at DESC').all();
  res.json(rows);
});

router.get('/events', async (req, res) => {
  const rows = await db
    .prepare('SELECT id, title, description, event_date, venue FROM events ORDER BY event_date DESC')
    .all();
  res.json(rows);
});

router.get('/committee', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT cm.id, cm.designation, cm.photo, m.name AS member_name, m.phone AS member_phone
       FROM core_members cm
       JOIN members m ON m.id = cm.member_id
       WHERE cm.end_date IS NULL
       ORDER BY cm.start_date ASC`
    )
    .all();
  res.json(rows);
});

router.post('/contact-messages', async (req, res) => {
  const { name, house_no, phone, email, message } = req.body || {};
  const cleanName = (name || '').toString().trim();
  const cleanPhone = (phone || '').toString().trim();
  const cleanMessage = (message || '').toString().trim();
  if (!cleanName || !cleanPhone || !cleanMessage) {
    return res.status(400).json({ error: 'Name, phone and message are required' });
  }
  await db.prepare(
    'INSERT INTO contact_messages (name, house_no, phone, email, message) VALUES (?, ?, ?, ?, ?)'
  ).run(
    cleanName.slice(0, 120),
    (house_no || '').toString().trim().slice(0, 40) || null,
    cleanPhone.slice(0, 32),
    (email || '').toString().trim().slice(0, 160) || null,
    cleanMessage.slice(0, 1000)
  );
  res.status(201).json({ ok: true });
});

module.exports = router;
