const express = require('express');
const db = require('../db');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

// resend_api_key must never leave the server - only expose whether email sending is set up
function toPublicSettings(row) {
  const { resend_api_key, ...safe } = row;
  return { ...safe, email_configured: !!resend_api_key };
}

router.get('/', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM general_settings WHERE id = 1').get();
  res.json(toPublicSettings(row));
});

router.put('/', requireAuth, requireSuperAdmin, async (req, res) => {
  const {
    maintenance_amount,
    app_name,
    contact_email,
    office_address,
    office_hours,
    phone_number,
    resend_api_key,
    resend_from_email,
    reminder_days,
    reminder_time,
  } = req.body || {};
  const existing = await db.prepare('SELECT * FROM general_settings WHERE id = 1').get();

  let finalMaintenanceAmount = existing.maintenance_amount;
  if (maintenance_amount !== undefined) {
    if (Number.isNaN(Number(maintenance_amount)) || Number(maintenance_amount) <= 0) {
      return res.status(400).json({ error: 'A valid maintenance amount is required' });
    }
    finalMaintenanceAmount = Number(maintenance_amount);
  }

  let finalReminderDays = existing.reminder_days;
  if (reminder_days !== undefined) {
    const days = String(reminder_days)
      .split(',')
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31);
    if (!days.length) return res.status(400).json({ error: 'Pick at least one reminder day' });
    finalReminderDays = [...new Set(days)].sort((a, b) => a - b).join(',');
  }

  let finalReminderTime = existing.reminder_time;
  if (reminder_time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder_time)) {
      return res.status(400).json({ error: 'Reminder time must be in HH:MM format' });
    }
    finalReminderTime = reminder_time;
  }

  await db.prepare(
    `UPDATE general_settings SET
       maintenance_amount = ?,
       app_name = ?, contact_email = ?, office_address = ?, office_hours = ?, phone_number = ?,
       resend_api_key = ?, resend_from_email = ?, reminder_days = ?, reminder_time = ?,
       updated_at = NOW()
     WHERE id = 1`
  ).run(
    finalMaintenanceAmount,
    app_name !== undefined ? app_name || null : existing.app_name,
    contact_email !== undefined ? contact_email || null : existing.contact_email,
    office_address !== undefined ? office_address || null : existing.office_address,
    office_hours !== undefined ? office_hours || null : existing.office_hours,
    phone_number !== undefined ? phone_number || null : existing.phone_number,
    // blank/omitted key keeps the existing one, so admins don't have to re-enter it every save
    resend_api_key ? resend_api_key : existing.resend_api_key,
    resend_from_email !== undefined ? resend_from_email || null : existing.resend_from_email,
    finalReminderDays,
    finalReminderTime
  );
  const row = await db.prepare('SELECT * FROM general_settings WHERE id = 1').get();
  logActivity({
    actor: req.user?.username,
    action: 'update',
    entityType: 'general_settings',
    description: 'Updated general settings',
  });
  res.json(toPublicSettings(row));
});

router.post('/test-email', requireAuth, requireSuperAdmin, async (req, res) => {
  const settings = await db.prepare('SELECT contact_email FROM general_settings WHERE id = 1').get();
  const to = settings?.contact_email;
  if (!to) return res.status(400).json({ error: 'Set a Contact Email in General Settings first' });
  try {
    await sendMail({
      to,
      subject: 'SBMN App - Test Email',
      html: '<p>This is a test email from your SBMN app\'s General Settings. If you received this, email sending is working correctly.</p>',
    });
    res.json({ ok: true, to });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
