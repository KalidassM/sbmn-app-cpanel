const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Indian financial year runs April-March; "fy" query param is "YYYY-YY", e.g. "2025-26"
function fyRange(fy) {
  const m = /^(\d{4})-(\d{2})$/.exec(fy || '');
  if (!m) return null;
  const startYear = Number(m[1]);
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

router.get('/itr-summary', requireAuth, requireAdmin, async (req, res) => {
  const { fy, from, to } = req.query;
  let range;
  let fyLabel = null;

  if (from || to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
      return res.status(400).json({ error: 'from/to must both be provided in YYYY-MM-DD format' });
    }
    if (from > to) {
      return res.status(400).json({ error: 'From date must not be after To date' });
    }
    range = { start: from, end: to };
  } else {
    range = fyRange(fy);
    if (!range) return res.status(400).json({ error: 'fy must be in YYYY-YY format, e.g. 2025-26, or provide from/to dates' });
    fyLabel = fy;
  }
  const { start, end } = range;

  // Cash basis: dues counted when actually paid (paid_date), not the due period they were billed for
  const maintenancePayments = await db
    .prepare(
      `SELECT mp.id, mp.member_id, m.name AS member_name, m.site_no, mp.month, mp.year,
              mp.amount_paid, mp.paid_date, mp.payment_mode, mp.reference_no
       FROM maintenance_payments mp JOIN members m ON m.id = mp.member_id
       WHERE mp.amount_paid > 0 AND mp.paid_date BETWEEN ? AND ?
       ORDER BY mp.paid_date`
    )
    .all(start, end);

  const donations = await db
    .prepare(
      `SELECT d.id, d.member_id, COALESCE(m.name, d.donor_name) AS donor_name, d.amount, d.donation_date, d.purpose
       FROM donations d LEFT JOIN members m ON m.id = d.member_id
       WHERE d.donation_date BETWEEN ? AND ?
       ORDER BY d.donation_date`
    )
    .all(start, end);

  const expenseRows = await db
    .prepare(
      `SELECT id, title, category, amount, expense_date, source, notes
       FROM expenses WHERE expense_date BETWEEN ? AND ? ORDER BY expense_date`
    )
    .all(start, end);

  const maintenanceTotal = maintenancePayments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
  const donationsTotal = donations.reduce((sum, d) => sum + Number(d.amount), 0);

  const expensesByCategory = {};
  const expensesBySource = { bank: 0, petty_cash: 0 };
  let expensesTotal = 0;
  expenseRows.forEach((e) => {
    const cat = e.category || 'Uncategorized';
    expensesByCategory[cat] = (expensesByCategory[cat] || 0) + Number(e.amount);
    expensesBySource[e.source] = (expensesBySource[e.source] || 0) + Number(e.amount);
    expensesTotal += Number(e.amount);
  });

  const association = await db
    .prepare('SELECT app_name, contact_email, office_address, phone_number FROM general_settings WHERE id = 1')
    .get();

  const incomeTotal = maintenanceTotal + donationsTotal;

  res.json({
    fy: fyLabel,
    dateRange: { start, end },
    association: association || {},
    income: { maintenance: maintenanceTotal, donations: donationsTotal, total: incomeTotal },
    expenses: {
      byCategory: Object.entries(expensesByCategory).map(([category, amount]) => ({ category, amount })),
      bySource: expensesBySource,
      total: expensesTotal,
    },
    net: incomeTotal - expensesTotal,
    details: { maintenancePayments, donations, expenses: expenseRows },
  });
});

module.exports = router;
