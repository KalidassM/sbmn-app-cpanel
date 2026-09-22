const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

async function computeSummary() {
  const totalTopups = (await db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM petty_cash_transactions WHERE type = 'topup'")
    .get()).s;
  const totalExpenses = (await db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM petty_cash_transactions WHERE type = 'expense'")
    .get()).s;
  return { totalTopups, totalExpenses, balance: totalTopups - totalExpenses };
}

router.get('/', requireAuth, async (req, res) => {
  const transactions = await db.prepare('SELECT * FROM petty_cash_transactions ORDER BY txn_date DESC, id DESC').all();
  res.json({ transactions, summary: await computeSummary() });
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { type, amount, txn_date, description, category } = req.body || {};
  if (!['topup', 'expense'].includes(type)) {
    return res.status(400).json({ error: "type must be 'topup' or 'expense'" });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'A valid amount is required' });
  }
  if (!description || !description.trim()) {
    return res.status(400).json({ error: 'Description is required' });
  }
  const date = txn_date || new Date().toISOString().slice(0, 10);

  const tx = db.transaction(async () => {
    let expenseId = null;
    if (type === 'expense') {
      const expenseInfo = await db
        .prepare(
          `INSERT INTO expenses (title, category, amount, expense_date, source, notes)
           VALUES (?, ?, ?, ?, 'petty_cash', 'Paid from petty cash')`
        )
        .run(description.trim(), category || 'Petty Cash', amount, date);
      expenseId = expenseInfo.lastInsertRowid;
    }
    const info = await db
      .prepare(
        `INSERT INTO petty_cash_transactions (type, amount, txn_date, description, category, expense_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(type, amount, date, description.trim(), category || null, expenseId);
    return info.lastInsertRowid;
  });

  const id = await tx();
  const row = await db.prepare('SELECT * FROM petty_cash_transactions WHERE id = ?').get(id);
  logActivity({
    actor: req.user?.username,
    action: 'create',
    entityType: 'petty_cash',
    entityId: row.id,
    description: `Added ${row.type} of ₹${row.amount} - ${row.description}`,
  });
  res.status(201).json({ transaction: row, summary: await computeSummary() });
});

// Type is fixed on edit (flipping topup<->expense would require creating/removing the linked
// expense row); amount/date/description/category can be corrected, and stay in sync with the
// linked expenses row if this transaction is a petty-cash expense.
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM petty_cash_transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });
  const { amount, txn_date, description, category } = req.body || {};
  if (amount !== undefined && (!amount || amount <= 0)) {
    return res.status(400).json({ error: 'A valid amount is required' });
  }
  const finalAmount = amount ?? existing.amount;
  const finalDate = txn_date || existing.txn_date;
  const finalDescription = description !== undefined && description.trim() ? description.trim() : existing.description;
  const finalCategory = category !== undefined ? category || null : existing.category;

  await db.transaction(async () => {
    await db.prepare(
      `UPDATE petty_cash_transactions SET amount = ?, txn_date = ?, description = ?, category = ? WHERE id = ?`
    ).run(finalAmount, finalDate, finalDescription, finalCategory, req.params.id);
    if (existing.expense_id) {
      await db.prepare('UPDATE expenses SET title = ?, category = ?, amount = ?, expense_date = ? WHERE id = ?').run(
        finalDescription,
        finalCategory || 'Petty Cash',
        finalAmount,
        finalDate,
        existing.expense_id
      );
    }
  })();

  const row = await db.prepare('SELECT * FROM petty_cash_transactions WHERE id = ?').get(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'update',
    entityType: 'petty_cash',
    entityId: row.id,
    description: `Updated ${row.type} of ₹${row.amount} - ${row.description}`,
  });
  res.json({ transaction: row, summary: await computeSummary() });
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM petty_cash_transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });

  const tx = db.transaction(async () => {
    if (existing.expense_id) {
      await db.prepare('DELETE FROM expenses WHERE id = ?').run(existing.expense_id);
    }
    await db.prepare('DELETE FROM petty_cash_transactions WHERE id = ?').run(req.params.id);
  });
  await tx();

  logActivity({
    actor: req.user?.username,
    action: 'delete',
    entityType: 'petty_cash',
    entityId: existing.id,
    description: `Deleted ${existing.type} of ₹${existing.amount} - ${existing.description}`,
  });
  res.json({ ok: true, summary: await computeSummary() });
});

module.exports = router;
