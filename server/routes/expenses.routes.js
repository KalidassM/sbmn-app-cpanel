const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { year, month } = req.query;
  let sql = 'SELECT * FROM expenses';
  const clauses = [];
  const params = [];
  if (year) {
    clauses.push('YEAR(expense_date) = ?');
    params.push(Number(year));
  }
  if (month) {
    clauses.push('MONTH(expense_date) = ?');
    params.push(Number(month));
  }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY expense_date DESC';
  res.json(await db.prepare(sql).all(...params));
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { title, category, amount, expense_date, event_id, notes } = req.body || {};
  if (!title || amount === undefined) {
    return res.status(400).json({ error: 'title and amount are required' });
  }
  const info = await db
    .prepare(
      `INSERT INTO expenses (title, category, amount, expense_date, event_id, notes)
       VALUES (?, ?, ?, COALESCE(?, CURDATE()), ?, ?)`
    )
    .run(title, category || null, amount, expense_date || null, event_id || null, notes || null);
  const expense = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
  logActivity({
    actor: req.user?.username,
    action: 'create',
    entityType: 'expense',
    entityId: expense.id,
    description: `Added expense "${expense.title}" of ₹${expense.amount}`,
  });
  res.status(201).json(expense);
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });
  const { title, category, amount, expense_date, event_id, notes } = req.body || {};
  await db.prepare(
    `UPDATE expenses SET title = ?, category = ?, amount = ?, expense_date = ?, event_id = ?, notes = ? WHERE id = ?`
  ).run(
    title ?? existing.title,
    category ?? existing.category,
    amount ?? existing.amount,
    expense_date ?? existing.expense_date,
    event_id !== undefined ? event_id : existing.event_id,
    notes ?? existing.notes,
    req.params.id
  );
  const expense = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'update',
    entityType: 'expense',
    entityId: expense.id,
    description: `Updated expense "${expense.title}" of ₹${expense.amount}`,
  });
  res.json(expense);
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });
  await db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  logActivity({
    actor: req.user?.username,
    action: 'delete',
    entityType: 'expense',
    entityId: existing.id,
    description: `Deleted expense "${existing.title}" of ₹${existing.amount}`,
  });
  res.json({ ok: true });
});

module.exports = router;
