const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/summary', requireAuth, async (req, res) => {
  const memberCount = (await db.prepare("SELECT COUNT(*) AS c FROM members WHERE status = 'active'").get()).c;
  const inactiveMemberCount = (await db.prepare("SELECT COUNT(*) AS c FROM members WHERE status = 'inactive'").get()).c;
  const coreMemberCount = (await db
    .prepare('SELECT COUNT(*) AS c FROM core_members WHERE end_date IS NULL')
    .get()).c;
  const upcomingEvents = (await db
    .prepare("SELECT COUNT(*) AS c FROM events WHERE event_date >= CURDATE()")
    .get()).c;
  const noticeCount = (await db.prepare('SELECT COUNT(*) AS c FROM notices').get()).c;
  const totalExpenses = (await db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM expenses').get()).s;
  const totalDonations = (await db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM donations WHERE status = 'completed'")
    .get()).s;
  // Lifetime total - feeds the running bank balance below, which must reflect all-time collections,
  // not just the current month.
  const totalMaintenanceCollected = (await db
    .prepare('SELECT COALESCE(SUM(amount_paid), 0) AS s FROM maintenance_payments')
    .get()).s;

  const now = new Date();
  const maintenanceCollectedThisMonth = (await db
    .prepare('SELECT COALESCE(SUM(amount_paid), 0) AS s FROM maintenance_payments WHERE month = ? AND year = ?')
    .get(now.getMonth() + 1, now.getFullYear())).s;
  const totalMaintenanceDue = (await db
    .prepare(
      `SELECT COALESCE(SUM(mp.amount_due - mp.amount_paid), 0) AS s
       FROM maintenance_payments mp
       JOIN members m ON m.id = mp.member_id
       WHERE mp.status != 'paid' AND mp.month = ? AND mp.year = ? AND m.status = 'active'`
    )
    .get(now.getMonth() + 1, now.getFullYear())).s;

  const balance = totalMaintenanceCollected + totalDonations - totalExpenses;

  res.json({
    memberCount,
    inactiveMemberCount,
    coreMemberCount,
    upcomingEvents,
    noticeCount,
    totalExpenses,
    totalDonations,
    totalMaintenanceCollected,
    maintenanceCollectedThisMonth,
    totalMaintenanceDue,
    balance,
  });
});

module.exports = router;
