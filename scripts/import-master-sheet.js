// Historical/ongoing sync: imports the "SBMN Master Sheet - Monthly Collection" CSV into
// members + maintenance_payments. Column layout is detected from the header row (not hardcoded
// indices) - "Plot No.", "Name", optionally "Mobile#", and any header matching "Mon-YY" (e.g.
// "Sep-25") is treated as a due month, in whatever order/range they appear. This lets the same
// script handle sheet revisions that add months or drop the Mobile# column without editing code.
//
// Skips non-member rows (Empty Land / Under Construction / Not yet Sold / Test Transaction /
// pipeline-amount placeholders) if present. Each month column becomes a maintenance_payments row
// (amount_due=300, amount_paid=cell value or 0 if blank).
//
// join_date is only ever set when a member is first created here, inferred from the first
// non-blank month in their row (falls back to the sheet's first month if every cell is blank).
// Re-running against an existing member never touches join_date - it may have been hand-corrected
// since, and this script only refreshes phone (if the sheet has a Mobile# column) + dues. Whatever
// join_date is already on record decides which months get due rows, and any now-stray pre-join
// rows are removed.
//
// Usage: node scripts/import-master-sheet.js <path-to-csv> [--apply]
// Without --apply, runs as a dry run and only prints the summary/flags - no DB writes.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SKIP_NAMES = new Set(['empty land', 'under construction', 'not yet sold', 'test transaction', 'david ( pipeline amount )']);
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function period(m, y) {
  return y * 100 + m;
}

function monthFromHeader(h) {
  const m = (h || '').trim().match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const idx = MONTH_NAMES.indexOf(m[1].toLowerCase());
  if (idx === -1) return null;
  return { month: idx + 1, year: 2000 + Number(m[2]) };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function main() {
  const csvPath = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!csvPath) {
    console.error('Usage: node scripts/import-master-sheet.js <path-to-csv> [--apply]');
    process.exit(1);
  }

  const text = fs.readFileSync(csvPath, 'utf8');
  const allRows = parseCsv(text);
  const header = allRows[0];
  const rows = allRows.slice(1);

  const siteNoCol = header.findIndex((h) => h.trim().toLowerCase() === 'plot no.');
  const nameCol = header.findIndex((h) => h.trim().toLowerCase() === 'name');
  const phoneCol = header.findIndex((h) => h.trim().toLowerCase() === 'mobile#');
  const monthCols = header.map((h, i) => ({ i, key: monthFromHeader(h) })).filter((c) => c.key);
  if (siteNoCol === -1 || nameCol === -1 || !monthCols.length) {
    console.error('Could not find "Plot No.", "Name", or any "Mon-YY" month columns in the header row.');
    process.exit(1);
  }
  console.log(
    `Detected columns - Plot No.: ${siteNoCol}, Name: ${nameCol}, Mobile#: ${phoneCol === -1 ? '(none in this sheet)' : phoneCol}, months: ${monthCols
      .map((c) => `${c.key.month}/${c.key.year}`)
      .join(', ')}`
  );

  const parsed = [];
  const noHistory = [];
  for (const r of rows) {
    const siteNo = (r[siteNoCol] || '').trim();
    const name = (r[nameCol] || '').trim();
    const phone = phoneCol === -1 ? null : (r[phoneCol] || '').trim();

    if (!name) continue; // fully blank / totals rows
    if (SKIP_NAMES.has(name.toLowerCase())) continue;

    const monthlyAmounts = monthCols.map((c) => {
      const raw = (r[c.i] || '').trim();
      return raw === '' ? 0 : Number(raw);
    });
    const firstDataIdx = monthCols.findIndex((c) => (r[c.i] || '').trim() !== '');
    const joinIdx = firstDataIdx === -1 ? 0 : firstDataIdx;
    const joinMonth = monthCols[joinIdx].key;
    const joinDate = `${joinMonth.year}-${String(joinMonth.month).padStart(2, '0')}-01`;
    if (firstDataIdx === -1) noHistory.push({ siteNo, name });

    parsed.push({ siteNo, name, phone, monthlyAmounts, joinDate, joinPeriod: period(joinMonth.month, joinMonth.year) });
  }

  // Surface duplicate site numbers up front - not an error, just worth a human glance
  const bySiteNo = new Map();
  parsed.forEach((p) => {
    if (!p.siteNo) return;
    if (!bySiteNo.has(p.siteNo)) bySiteNo.set(p.siteNo, []);
    bySiteNo.get(p.siteNo).push(p.name);
  });
  const duplicates = [...bySiteNo.entries()].filter(([, names]) => names.length > 1);

  console.log(`\nParsed ${parsed.length} member rows (skipped Empty Land / Under Construction / Not yet Sold / test rows, if any).`);
  if (duplicates.length) {
    console.log(`\nDuplicate Site Nos (${duplicates.length}):`);
    duplicates.forEach(([site, names]) => console.log(`  Site No ${site}: ${names.join(', ')}`));
  }
  if (noHistory.length) {
    console.log(`\nNo data in any month - join_date defaulted to the sheet's first month (${noHistory.length}):`);
    noHistory.forEach((f) => console.log(`  Site No ${f.siteNo} (${f.name})`));
  }

  if (!apply) {
    console.log('\nDry run only - no DB writes. Re-run with --apply to write to the DB.');
    return;
  }

  const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite'));
  const findBySiteNo = db.prepare('SELECT id, join_date FROM members WHERE site_no = ? AND name = ?');
  const insertMember = db.prepare(
    `INSERT INTO members (name, site_no, phone, join_date, status) VALUES (?, ?, ?, ?, 'active')`
  );
  // join_date is deliberately NOT touched here - an existing member's join_date may already have
  // been corrected by hand, and blindly recomputing it from the CSV's first non-blank month every
  // time would silently revert that correction. Phone is only touched if this sheet has a
  // Mobile# column at all - otherwise leave whatever's already on file alone.
  const updateMemberPhone = db.prepare('UPDATE members SET phone = ? WHERE id = ?');
  const upsertDue = db.prepare(
    `INSERT INTO maintenance_payments (member_id, month, year, amount_due, amount_paid, status)
     VALUES (?, ?, ?, 300, ?, ?)
     ON CONFLICT(member_id, month, year) DO UPDATE SET amount_due = 300, amount_paid = excluded.amount_paid, status = excluded.status`
  );
  const deletePreJoinDue = db.prepare(
    `DELETE FROM maintenance_payments WHERE member_id = ? AND (year * 100 + month) < ?`
  );

  let membersCreated = 0;
  let membersUpdated = 0;
  let duesWritten = 0;
  let staleDuesRemoved = 0;

  db.transaction(() => {
    for (const p of parsed) {
      let existing = p.siteNo ? findBySiteNo.get(p.siteNo, p.name) : null;
      let memberId;
      let joinPeriod = p.joinPeriod;
      if (existing) {
        memberId = existing.id;
        if (phoneCol !== -1) updateMemberPhone.run(p.phone || null, memberId);
        membersUpdated++;
        // Trust whatever join_date is already on record (possibly hand-corrected) over the CSV guess.
        const [y, m] = existing.join_date.split('-').map(Number);
        joinPeriod = period(m, y);
      } else {
        const info = insertMember.run(p.name, p.siteNo || null, p.phone || null, p.joinDate);
        memberId = info.lastInsertRowid;
        membersCreated++;
      }

      monthCols.forEach((c, idx) => {
        if (period(c.key.month, c.key.year) < joinPeriod) return; // before they joined - no due
        const paid = p.monthlyAmounts[idx];
        const status = paid >= 300 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
        upsertDue.run(memberId, c.key.month, c.key.year, paid, status);
        duesWritten++;
      });

      staleDuesRemoved += deletePreJoinDue.run(memberId, joinPeriod).changes;
    }
  })();

  console.log(
    `\nApplied: ${membersCreated} members created, ${membersUpdated} members updated, ${duesWritten} monthly due rows written, ${staleDuesRemoved} stale pre-join due rows removed.`
  );
}

main();
