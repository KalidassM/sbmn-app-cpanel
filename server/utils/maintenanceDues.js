const db = require('../db');

// Fills in due rows (using the general-settings monthly amount) for any active member who doesn't
// already have one for this month/year. Never touches an existing row, so manual corrections and
// payments already recorded are never overwritten by a later view of the same month.
async function ensureDuesGenerated(month, year) {
  const settings = await db.prepare('SELECT maintenance_amount FROM general_settings WHERE id = 1').get();
  if (!settings || !settings.maintenance_amount) return;

  // Skip members who hadn't joined yet as of this month/year - no due should exist for a period
  // before someone became a member.
  const period = year * 100 + month;
  const members = await db
    .prepare(
      `SELECT id FROM members
       WHERE status = 'active'
         AND (YEAR(join_date) * 100 + MONTH(join_date)) <= ?`
    )
    .all(period);
  const insert = db.prepare(
    `INSERT IGNORE INTO maintenance_payments (member_id, month, year, amount_due, amount_paid, status)
     VALUES (?, ?, ?, ?, 0, 'unpaid')`
  );
  await db.transaction(async (rows) => {
    for (const m of rows) await insert.run(m.id, month, year, settings.maintenance_amount);
  })(members);
}

module.exports = { ensureDuesGenerated };
