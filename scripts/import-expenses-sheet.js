// One-off historical backfill of "SBMN Master Sheet - Expenses.csv" into the real expenses +
// petty_cash_transactions tables. The source sheet has two distinct sections with irregular,
// hand-written formatting (mixed date formats, embedded section headers, running-balance
// columns) - rather than write a fragile generic parser, this script hand-transcribes each row
// as data below, verified against the sheet's own arithmetic before being trusted:
//   - BANK_EXPENSES (rows 1-59 of the sheet): expenses paid directly from association funds,
//     not through the petty cash box. Sums to exactly Rs 59,016.94, matching the sheet's own
//     total row - confirms the transcription is accurate.
//   - PETTY_CASH: the two "...expenses,Db,Balance" ledgers. Starts from a true Rs 0 balance
//     (first entry is the very first-ever petty cash withdrawal) and its own running-balance
//     math ends at exactly Rs 8,187 - which matches general_settings.opening_petty_cash_balance
//     already configured in the app today. Per the user, that Rs 8,187 is actually this ledger's
//     end balance copied in as a snapshot, not an independent pre-tracking baseline - so this
//     script resets opening_petty_cash_balance to 0 and imports the full ledger, which nets back
//     out to the same Rs 8,187 but now with full transaction detail instead of one opaque number.
//
// Each petty-cash "expense" (not "topup") row also creates a linked expenses row with
// source='petty_cash', mirroring exactly what the app's own Petty Cash page does when you record
// a cash expense (see server/routes/pettyCash.routes.js POST /).
//
// This is a one-time historical import, not a recurring monthly sync like
// import-master-sheet.js - re-running it would create duplicate rows, so it refuses to run
// twice unless --force is passed (detected via a marker expense title unique to this import).
//
// Usage: node scripts/import-expenses-sheet.js [--apply] [--force]

const path = require('path');
const Database = require('better-sqlite3');

// --- Segment A: paid directly from association funds (source='bank') ---
const BANK_EXPENSES = [
  { title: 'Kalidass spent amount for Association Registration and Other expenses', amount: 2811, paidBy: 'Transfered to Kalidass', date: '2025-09-01' },
  { title: 'Meeting chair and table', amount: 600, paidBy: 'Paid by Association Amt', date: '2025-09-14' },
  { title: 'CCTV Amount', amount: 18000, paidBy: 'Paid by Association Amt', date: '2025-10-10' },
  { title: 'Porter Amount for CCTV Delivery', amount: 150, paidBy: 'Paid by Association Amt', date: '2025-10-10' },
  { title: 'Water Man Amount (Sep, Oct Month)', amount: 1000, paidBy: 'Paid by Association Amt', date: '2025-10-13' },
  { title: 'SIM Card Cost', amount: 300, paidBy: 'Paid by Association Amt', date: '2025-10-16' },
  { title: 'Ladder Rent Cost', amount: 120, paidBy: 'Paid by Association Amt', date: '2025-10-16' },
  { title: 'CCTV Installation Cost', amount: 1600, paidBy: 'Paid by Association Amt', date: '2025-10-16' },
  { title: 'Sim recharge', amount: 452.32, paidBy: 'Karthick', date: '2025-10-20' },
  { title: 'EB Fuse change', amount: 100, paidBy: 'Kalidass', date: '2025-11-15' },
  { title: 'Name board near pipe repair', amount: 300, paidBy: 'Kalidass', date: '2025-11-15' },
  { title: 'Sim recharge', amount: 452.32, paidBy: 'Karthick', date: '2025-11-15' },
  { title: 'Dec sim recharge', amount: 452.32, paidBy: 'karthick', date: '2025-12-15' },
  { title: 'Dec sim recharge', amount: 373, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'Stamp and Rapido charges (Paid by Karthick)', amount: 850, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'Meeting chair charges', amount: 860, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'Meeting Tea charges', amount: 565, paidBy: 'Kalidass', date: '2025-12-15' },
  { title: 'Park and empty site cleaning JCB charges', amount: 7800, paidBy: 'Mathan', date: '2025-12-15' },
  { title: 'JCB driver amount', amount: 400, paidBy: 'Kalidass', date: '2025-12-15' },
  { title: 'Two new post installation charges', amount: 8000, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'Line man amount for front light', amount: 100, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'water man charges', amount: 500, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'Xerox (voter list, Panchayat, EB)', amount: 200, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'Plumber', amount: 250, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'New year amount SBI', amount: 2000, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'Plumber', amount: 100, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'Pipe', amount: 497, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'New year amount SBI', amount: 2000, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'Sim Recharge', amount: 624.34, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'Pongal', amount: 1070, paidBy: 'Karthick', date: '2025-12-15' },
  { title: 'Water man', amount: 500, paidBy: 'Karthick', date: '2026-01-15' },
  { title: 'Pipe line fix near Edwin house + Tab replace near prabhu house (600 + 520 + 50 = 1170)', amount: 1170, paidBy: 'Kalidass', date: '2026-01-15' },
  { title: 'Sim recharge', amount: 724.82, paidBy: 'Karthick', date: '2026-02-15' },
  { title: 'Pipe repair near site 27', amount: 60, paidBy: 'Karthick', date: '2026-02-15' },
  { title: 'plumber for water block', amount: 200, paidBy: 'Kalidass', date: '2026-02-15' },
  { title: 'Sim recharge', amount: 824.82, paidBy: 'Karthick', date: '2026-03-15' },
  { title: 'Sweeper', amount: 200, paidBy: 'Kalidass', date: '2026-03-15' },
  { title: 'Sweeper', amount: 1050, paidBy: 'Kalidass', date: '2026-03-15' },
  { title: 'MLA shawl', amount: 360, paidBy: 'Kalidass', date: '2026-03-15' },
  { title: 'Voucher printing and design', amount: 900, paidBy: 'Kalidass', date: '2026-03-15' },
  { title: 'Chair - MLA meeting', amount: 500, paidBy: 'Karthick', date: '2026-03-15' },
];
const BANK_EXPENSES_EXPECTED_TOTAL = 59016.94;

// --- Segment B: petty cash ledger (type, amount, date, description, paidBy) ---
const PETTY_CASH = [
  { type: 'topup', amount: 10000, date: '2026-03-17', description: 'Petty Cash withdrawal', paidBy: null },
  { type: 'expense', amount: 1080, date: '2026-03-15', description: 'Chair expenses (WMs day)', paidBy: 'Karthik' },
  { type: 'expense', amount: 600, date: '2026-03-15', description: 'Cake expenses (WMs day)', paidBy: 'Madan' },
  { type: 'expense', amount: 500, date: '2026-03-16', description: 'Water expenses', paidBy: 'Kalidass' },
  { type: 'expense', amount: 50, date: '2026-03-16', description: 'Garbage tip', paidBy: 'Kalidass' },
  { type: 'expense', amount: 825, date: '2026-04-04', description: 'Airtel Recharge (Apr)', paidBy: 'Madan' },
  { type: 'expense', amount: 1000, date: '2026-04-13', description: 'Garbage monthly tip', paidBy: 'Kalidass' },
  { type: 'expense', amount: 500, date: '2026-05-05', description: 'Waterman expense', paidBy: 'Kalidass' },
  { type: 'expense', amount: 200, date: '2026-05-05', description: 'Plumber expense', paidBy: 'Kalidass' },
  { type: 'expense', amount: 825, date: '2026-05-07', description: 'Airtel Recharge (May)', paidBy: 'Karthik' },
  { type: 'expense', amount: 200, date: '2026-05-08', description: 'Dog Corpse Dispose', paidBy: 'Govindan' },
  { type: 'expense', amount: 1600, date: '2026-05-09', description: 'Chair Cost (to PS)', paidBy: 'Madan' },
  { type: 'expense', amount: 1000, date: '2026-05-11', description: 'Garbage', paidBy: 'Govindan' },
  { type: 'expense', amount: 200, date: '2026-06-04', description: 'StreetLight fix paid to Joyal', paidBy: 'Kalidass' },
  { type: 'expense', amount: 500, date: '2026-06-05', description: 'Waterman expense', paidBy: 'Kalidass' },
  { type: 'topup', amount: 10000, date: '2026-06-06', description: 'Petty cash withdrawal', paidBy: null },
  { type: 'expense', amount: 825, date: '2026-06-06', description: 'Airtel Recharge (Jun)', paidBy: 'Karthik' },
  { type: 'expense', amount: 1000, date: '2026-06-09', description: 'Garbage', paidBy: 'Govindan' },
  { type: 'expense', amount: 100, date: '2026-06-10', description: 'StreetLight fix paid to Joyal', paidBy: 'Kalidass' },
  { type: 'expense', amount: 1300, date: '2026-06-12', description: 'House# Paint Labour charge (day1) paid to Raja painter', paidBy: null },
  { type: 'expense', amount: 1300, date: '2026-06-13', description: 'House# Paint Labour charge (day2) paid to Raja painter', paidBy: null },
  { type: 'expense', amount: 900, date: '2026-06-13', description: 'Paint charges (hardware shop)', paidBy: null },
  { type: 'expense', amount: 870, date: '2026-06-14', description: 'Snacks (incl paper plate) charges for meeting', paidBy: 'Karthik' },
  { type: 'expense', amount: 690, date: '2026-06-14', description: 'Chair/Table charges for meeting', paidBy: 'Karthik' },
  { type: 'expense', amount: 320, date: '2026-07-04', description: 'Shawl expenses for MLA meeting', paidBy: 'Kalidass' },
  { type: 'expense', amount: 1860, date: '2026-07-04', description: 'Plant bushes near Nameboard & Overhead tank bushes cleaning expenses (incl. tea, plumbing)', paidBy: 'Kalidass' },
  { type: 'expense', amount: 1088, date: '2026-07-04', description: 'Bakery eatable, Tea expenses for 20 members visiting MLA office', paidBy: 'Madan' },
  { type: 'topup', amount: 10000, date: '2026-07-13', description: 'Petty cash withdrawal', paidBy: null },
  { type: 'expense', amount: 1500, date: '2026-07-13', description: 'FY24-25 filing - Professional & Consultation fee to auditor', paidBy: 'Madan' },
  { type: 'expense', amount: 700, date: '2026-07-28', description: 'Hardware items bought for air tight problem in water pipeline', paidBy: 'Kalidass' },
  { type: 'expense', amount: 280, date: '2026-07-12', description: 'Non-veg lunch stationary expenditure', paidBy: 'Kalidass' },
];
const PETTY_CASH_EXPECTED_ENDING_BALANCE = 8187;

// Marker used to detect (and refuse to repeat) a prior run of this specific import
const MARKER_TITLE = 'Kalidass spent amount for Association Registration and Other expenses';

function verifyTotals() {
  const bankTotal = BANK_EXPENSES.reduce((s, e) => s + e.amount, 0);
  const bankOk = Math.abs(bankTotal - BANK_EXPENSES_EXPECTED_TOTAL) < 0.01;

  let balance = 0;
  for (const p of PETTY_CASH) {
    balance += p.type === 'topup' ? p.amount : -p.amount;
  }
  const pettyOk = Math.abs(balance - PETTY_CASH_EXPECTED_ENDING_BALANCE) < 0.01;

  console.log(`Bank expenses: ${BANK_EXPENSES.length} rows, sum = ${bankTotal.toFixed(2)} (sheet's own total: ${BANK_EXPENSES_EXPECTED_TOTAL}) - ${bankOk ? 'MATCH' : 'MISMATCH!'}`);
  console.log(
    `Petty cash: ${PETTY_CASH.length} rows, ending balance from Rs 0 = ${balance.toFixed(2)} (expected: ${PETTY_CASH_EXPECTED_ENDING_BALANCE}) - ${pettyOk ? 'MATCH' : 'MISMATCH!'}`
  );
  return bankOk && pettyOk;
}

function main() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  if (!verifyTotals()) {
    console.error('\nTotals do not match the source sheet - refusing to proceed. Check the transcribed data above.');
    process.exit(1);
  }

  if (!apply) {
    console.log('\nDry run only - no DB writes. Re-run with --apply to write to the DB.');
    return;
  }

  const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite'));

  const alreadyImported = db.prepare('SELECT COUNT(*) AS c FROM expenses WHERE title = ?').get(MARKER_TITLE).c > 0;
  if (alreadyImported && !force) {
    console.error(`\nAn expense titled "${MARKER_TITLE}" already exists - this import has likely already run. Pass --force to import anyway (will create duplicates).`);
    process.exit(1);
  }

  const insertBankExpense = db.prepare(
    `INSERT INTO expenses (title, amount, expense_date, source, notes) VALUES (?, ?, ?, 'bank', ?)`
  );
  const insertExpense = db.prepare(
    `INSERT INTO expenses (title, amount, expense_date, source, notes) VALUES (?, ?, ?, 'petty_cash', ?)`
  );
  const insertPettyCashTxn = db.prepare(
    `INSERT INTO petty_cash_transactions (type, amount, txn_date, description, category, expense_id) VALUES (?, ?, ?, ?, 'Petty Cash', ?)`
  );
  const setOpeningPettyCash = db.prepare(`UPDATE general_settings SET opening_petty_cash_balance = 0 WHERE id = 1`);

  let bankInserted = 0;
  let pettyCashInserted = 0;
  let linkedExpensesInserted = 0;

  db.transaction(() => {
    for (const e of BANK_EXPENSES) {
      insertBankExpense.run(e.title, e.amount, e.date, e.paidBy ? `Paid by: ${e.paidBy}` : null);
      bankInserted++;
    }

    setOpeningPettyCash.run();

    for (const p of PETTY_CASH) {
      let expenseId = null;
      if (p.type === 'expense') {
        const notes = p.paidBy ? `Paid by: ${p.paidBy}` : 'Paid from petty cash';
        const info = insertExpense.run(p.description, p.amount, p.date, notes);
        expenseId = info.lastInsertRowid;
        linkedExpensesInserted++;
      }
      insertPettyCashTxn.run(p.type, p.amount, p.date, p.description, expenseId);
      pettyCashInserted++;
    }
  })();

  console.log(
    `\nApplied: ${bankInserted} bank expenses inserted, opening_petty_cash_balance reset to 0, ${pettyCashInserted} petty cash transactions inserted (${linkedExpensesInserted} of which also created a linked petty-cash-sourced expense row).`
  );
}

main();
