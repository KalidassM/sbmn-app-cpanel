const db = require('../db');
const { ensureDuesGenerated } = require('./maintenanceDues');
const whatsapp = require('./whatsappClient');
const { baseUrl } = require('./appUrl');
const { signOff } = require('./memberNotify');

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const DEFAULT_REMINDER_DAYS = '1,2,3,4,5,7,10';
const DEFAULT_REMINDER_TIME = '10:00';

function nowIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour), minute: Number(map.minute) };
}

async function sendDailyReminders({ force = false } = {}) {
  if (!whatsapp.isConnected()) {
    return { skipped: true, reason: 'WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID.' };
  }

  const settings = await db
    .prepare('SELECT reminders_last_sent_date, app_name, reminder_days, reminder_time FROM general_settings WHERE id = 1')
    .get();

  const reminderDays = (settings?.reminder_days || DEFAULT_REMINDER_DAYS)
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => d >= 1 && d <= 31);
  const [reminderHour, reminderMinute] = (settings?.reminder_time || DEFAULT_REMINDER_TIME).split(':').map(Number);

  const { year, month, day, hour, minute } = nowIST();
  if (!force && !reminderDays.includes(day)) {
    return { skipped: true, reason: 'Not a scheduled reminder day' };
  }
  if (!force && hour * 60 + minute < reminderHour * 60 + reminderMinute) {
    return { skipped: true, reason: `Scheduled for ${settings.reminder_time} IST today - not yet time` };
  }

  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!force && settings?.reminders_last_sent_date === dateKey) {
    return { skipped: true, reason: `Already sent today (${dateKey})` };
  }

  await ensureDuesGenerated(month, year);

  const dues = await db
    .prepare(
      `SELECT mp.id, mp.amount_due, mp.amount_paid, mp.month, mp.year, m.name, m.phone, m.site_no
       FROM maintenance_payments mp
       JOIN members m ON m.id = mp.member_id
       WHERE mp.month = ? AND mp.year = ? AND mp.status != 'paid' AND m.status = 'active'`
    )
    .all(month, year);

  const markSent = db.prepare(
    "UPDATE maintenance_payments SET last_reminder_sent_at = NOW(), last_reminder_error = NULL WHERE id = ?"
  );
  const markFailed = db.prepare('UPDATE maintenance_payments SET last_reminder_error = ? WHERE id = ?');

  const sent = [];
  const failed = [];
  const skippedNoPhone = [];

  for (const due of dues) {
    if (!due.phone || !due.phone.replace(/\D/g, '')) {
      skippedNoPhone.push(due.name);
      await markFailed.run('No phone number on file', due.id);
      continue;
    }
    const remaining = Number(due.amount_due) - Number(due.amount_paid);
    const link = `${baseUrl()}/pay-monthly-maintenance?q=${encodeURIComponent(due.site_no || due.name)}`;

    const message =
      `*Hi ${due.name},*  This is a reminder that your maintenance due of *₹${remaining} ` +
      `for ${MONTH_NAMES[due.month]} ${due.year} (Site No ${due.site_no || '-'})* is still pending.\n\n` +
      `*Pay Now:* ${link}\n\n` +
      (await signOff());
    try {
      await whatsapp.sendMessage(due.phone, message);
      sent.push(due.name);
      await markSent.run(due.id);
    } catch (err) {
      failed.push({ name: due.name, error: err.message });
      await markFailed.run(err.message, due.id);
    }
  }

  await db.prepare('UPDATE general_settings SET reminders_last_sent_date = ? WHERE id = 1').run(dateKey);

  return { skipped: false, dateKey, totalDue: dues.length, sent, failed, skippedNoPhone };
}

module.exports = { sendDailyReminders };
