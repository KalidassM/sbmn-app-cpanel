const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');
const { ensureDuesGenerated } = require('../utils/maintenanceDues');
const { notifyAdminOfPayment, notifyPaymentWhatsApp } = require('../utils/paymentNotify');
const { sendDailyReminders } = require('../utils/maintenanceReminders');

const router = express.Router();

router.get('/payments', requireAuth, async (req, res) => {
  const { month, year, member_id } = req.query;
  if (month && year) {
    await ensureDuesGenerated(Number(month), Number(year));
  }

  let sql = `SELECT mp.*, m.name AS member_name, m.site_no, m.phone FROM maintenance_payments mp
             JOIN members m ON m.id = mp.member_id`;
  // A currently-active member shows for every due. An inactive member only shows for dues from
  // before the month they went inactive in (e.g. active through July, inactive from August 5th ->
  // still shows on the July due, hidden from August onward) - a member with no inactive_date on
  // record has no way to know which months they were active for, so stays hidden everywhere.
  // Symmetrically, a member never shows for a due from before the month they joined in.
  const clauses = [
    `(m.status = 'active' OR (m.inactive_date IS NOT NULL AND (mp.year * 100 + mp.month) < (YEAR(m.inactive_date) * 100 + MONTH(m.inactive_date))))`,
    `(mp.year * 100 + mp.month) >= (YEAR(m.join_date) * 100 + MONTH(m.join_date))`,
  ];
  const params = [];
  if (month) {
    clauses.push('mp.month = ?');
    params.push(Number(month));
  }
  if (year) {
    clauses.push('mp.year = ?');
    params.push(Number(year));
  }
  if (member_id) {
    clauses.push('mp.member_id = ?');
    params.push(Number(member_id));
  }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY mp.year DESC, mp.month DESC, m.name';
  res.json(await db.prepare(sql).all(...params));
});

// Marks a batch of dues fully paid in one action (e.g. cash collected from several members at
// once) - skips any row already paid rather than erroring on it.
router.post('/payments/bulk-mark-paid', requireAuth, requireAdmin, async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const update = db.prepare(
    `UPDATE maintenance_payments SET amount_paid = amount_due, status = 'paid', paid_date = ?, paid_at = ? WHERE id = ? AND status != 'paid'`
  );
  let updated = 0;
  await db.transaction(async (rowIds) => {
    for (const id of rowIds) {
      const result = await update.run(today, now, id);
      updated += result.changes;
    }
  })(ids);
  logActivity({
    actor: req.user?.username,
    action: 'payment',
    entityType: 'maintenance_payment',
    description: `Bulk marked ${updated} of ${ids.length} selected due(s) as paid (ids: ${ids.join(', ')})`,
  });
  res.json({ updated });
});

// Admin-only view of who still owes for a month and whether the automated WhatsApp reminder
// reached them - pre-filtered server-side (unlike /payments) since it's built to surface phone
// numbers + delivery errors in bulk, which only the admin should see.
router.get('/reminders', requireAuth, requireAdmin, async (req, res) => {
  const month = Number(req.query.month) || new Date().getMonth() + 1;
  const year = Number(req.query.year) || new Date().getFullYear();
  await ensureDuesGenerated(month, year);

  const rows = await db
    .prepare(
      `SELECT mp.id, mp.amount_due, mp.amount_paid, mp.status, mp.last_reminder_sent_at, mp.last_reminder_error,
              m.name AS member_name, m.site_no, m.phone
       FROM maintenance_payments mp
       JOIN members m ON m.id = mp.member_id
       WHERE mp.month = ? AND mp.year = ? AND mp.status != 'paid' AND m.status = 'active'
       ORDER BY CAST(m.site_no AS SIGNED), m.site_no`
    )
    .all(month, year);
  res.json(rows);
});

// Manually re-runs today's reminder send, bypassing the day/time/already-sent guards - for
// testing a schedule change or re-notifying stragglers without waiting for tomorrow.
router.post('/reminders/resend-today', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await sendDailyReminders({ force: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/payments/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM maintenance_payments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Payment record not found' });
  const { amount_due, amount_paid, paid_date, status, payment_mode, reference_no } = req.body || {};
  const finalAmountDue = amount_due ?? existing.amount_due;
  const finalAmountPaid = amount_paid ?? existing.amount_paid;
  let finalStatus = status;
  if (!finalStatus) {
    if (finalAmountPaid <= 0) finalStatus = 'unpaid';
    else if (finalAmountPaid >= finalAmountDue) finalStatus = 'paid';
    else finalStatus = 'partial';
  }
  const becomingPaid = finalStatus === 'paid' && existing.status !== 'paid';
  await db.prepare(
    `UPDATE maintenance_payments SET amount_due = ?, amount_paid = ?, paid_date = ?, paid_at = ?, status = ?, payment_mode = ?, reference_no = ? WHERE id = ?`
  ).run(
    finalAmountDue,
    finalAmountPaid,
    paid_date ?? (finalStatus === 'paid' ? new Date().toISOString().slice(0, 10) : existing.paid_date),
    becomingPaid ? new Date().toISOString().slice(0, 19).replace('T', ' ') : existing.paid_at,
    finalStatus,
    payment_mode !== undefined ? payment_mode || null : existing.payment_mode,
    reference_no !== undefined ? reference_no || null : existing.reference_no,
    req.params.id
  );
  const row = await db.prepare('SELECT * FROM maintenance_payments WHERE id = ?').get(req.params.id);
  if (finalAmountPaid > existing.amount_paid) {
    notifyAdminOfPayment(row);
    notifyPaymentWhatsApp([row]);
  }
  const member = await db.prepare('SELECT name, site_no FROM members WHERE id = ?').get(row.member_id);
  logActivity({
    actor: req.user?.username,
    action: finalAmountPaid > existing.amount_paid ? 'payment' : 'update',
    entityType: 'maintenance_payment',
    entityId: row.id,
    description: `${member?.name || 'Member'} (Site No ${member?.site_no || '-'}) - ${row.month}/${row.year} maintenance set to ${finalStatus}, paid ₹${finalAmountPaid} of ₹${finalAmountDue}`,
  });
  res.json(row);
});

router.delete('/payments/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM maintenance_payments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Payment record not found' });
  await db.prepare('DELETE FROM maintenance_payments WHERE id = ?').run(req.params.id);
  const member = await db.prepare('SELECT name, site_no FROM members WHERE id = ?').get(existing.member_id);
  logActivity({
    actor: req.user?.username,
    action: 'delete',
    entityType: 'maintenance_payment',
    entityId: existing.id,
    description: `Deleted ${member?.name || 'member'} (Site No ${member?.site_no || '-'})'s maintenance due for ${existing.month}/${existing.year}`,
  });
  res.json({ ok: true });
});

module.exports = router;
