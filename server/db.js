const { AsyncLocalStorage } = require('async_hooks');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

// cPanel's first-class DB is MySQL, not a local SQLite file - this pool is the one connection
// point every route/util in the app goes through (via db.prepare/db.transaction below).
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true, // return DECIMAL columns (money amounts) as JS numbers, not strings
  dateStrings: true, // return DATE/DATETIME as 'YYYY-MM-DD[ HH:MM:SS]' strings, matching the old SQLite TEXT shape the rest of the app expects
});

// A transaction (see `transaction()` below) needs every query inside it to run on the same pooled
// connection so the BEGIN/COMMIT actually covers them. AsyncLocalStorage propagates that one
// connection through whatever `await` chain runs inside the transaction callback, so `db.prepare`
// below can stay oblivious to whether it's inside a transaction or not.
const txContext = new AsyncLocalStorage();

function conn() {
  return txContext.getStore() || pool;
}

// Mirrors better-sqlite3's db.prepare(sql).get/all/run(...params) shape so every existing call
// site only needs `await` added, not a rewrite - see server/index.js and every routes/utils file.
function prepare(sql) {
  return {
    async get(...params) {
      const [rows] = await conn().execute(sql, params);
      return rows[0];
    },
    async all(...params) {
      const [rows] = await conn().execute(sql, params);
      return rows;
    },
    async run(...params) {
      const [result] = await conn().execute(sql, params);
      // better-sqlite3 names these .changes/.lastInsertRowid - kept identical so call sites that
      // read result.lastInsertRowid after an INSERT don't need to change to result.insertId.
      return { changes: result.affectedRows, lastInsertRowid: result.insertId };
    },
  };
}

// Replaces better-sqlite3's synchronous db.transaction(fn) - returns an async function with the
// same call shape (`db.transaction(fn)(args)`), but callers must now `await` it and `fn` itself
// must be async and `await` each db call inside (both changed at every call site).
function transaction(fn) {
  return async (...args) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await txContext.run(connection, () => fn(...args));
      await connection.commit();
      return result;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  };
}

async function exec(sql) {
  await conn().query(sql);
}

async function columnsOf(table) {
  const [rows] = await pool.query(
    'SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
    [table]
  );
  return rows.map((r) => r.name);
}

const TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    site_no VARCHAR(50),
    address TEXT,
    phone VARCHAR(100),
    email VARCHAR(255),
    join_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    inactive_date DATE
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member','super_admin')),
    member_id INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    must_change_password TINYINT(1) NOT NULL DEFAULT 0,
    reset_code_hash VARCHAR(255),
    reset_code_expires_at DATETIME,
    last_login_at DATETIME,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS core_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id INT NOT NULL,
    designation VARCHAR(255) NOT NULL,
    start_date DATE,
    end_date DATE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    photo MEDIUMTEXT,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    venue VARCHAR(255),
    budget DECIMAL(12,2) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    amount DECIMAL(12,2) NOT NULL,
    expense_date DATE NOT NULL,
    event_id INT,
    notes TEXT,
    source VARCHAR(20) NOT NULL DEFAULT 'bank' CHECK(source IN ('bank','petty_cash')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS petty_cash_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(20) NOT NULL CHECK(type IN ('topup','expense')),
    amount DECIMAL(12,2) NOT NULL,
    txn_date DATE NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100),
    expense_id INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS maintenance_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    month INT NOT NULL,
    year INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    UNIQUE(month, year)
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS maintenance_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id INT NOT NULL,
    month INT NOT NULL,
    year INT NOT NULL,
    amount_due DECIMAL(12,2) NOT NULL,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    paid_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','paid','partial')),
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    payment_mode VARCHAR(50),
    reference_no VARCHAR(100),
    last_reminder_sent_at DATETIME,
    last_reminder_error TEXT,
    paid_at DATETIME,
    UNIQUE(member_id, month, year),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS donations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id INT,
    donor_name VARCHAR(255),
    amount DECIMAL(12,2) NOT NULL,
    donation_date DATE NOT NULL,
    purpose VARCHAR(255),
    event_id INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed')),
    source VARCHAR(20) NOT NULL DEFAULT 'admin' CHECK(source IN ('admin','member','public')),
    donor_email VARCHAR(255),
    donor_phone VARCHAR(50),
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS notices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    pinned TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS contact_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    house_no VARCHAR(50),
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS payment_settings (
    id INT PRIMARY KEY CHECK (id = 1),
    upi_id VARCHAR(255),
    payee_name VARCHAR(255),
    bank_name VARCHAR(255),
    account_no VARCHAR(50),
    ifsc_code VARCHAR(20),
    razorpay_key_id VARCHAR(255),
    razorpay_key_secret VARCHAR(255),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS general_settings (
    id INT PRIMARY KEY CHECK (id = 1),
    maintenance_amount DECIMAL(12,2),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    app_name VARCHAR(255),
    contact_email VARCHAR(255),
    office_address TEXT,
    office_hours VARCHAR(255),
    phone_number VARCHAR(50),
    resend_api_key VARCHAR(255),
    resend_from_email VARCHAR(255),
    reminders_last_sent_date DATE,
    reminder_days VARCHAR(100) NOT NULL DEFAULT '1,2,3,4,5,7,10',
    reminder_time VARCHAR(10) NOT NULL DEFAULT '10:00'
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    actor VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id INT,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ${TABLE_OPTIONS}`,
];

async function setup() {
  for (const statement of SCHEMA) {
    await pool.query(statement);
  }

  await pool.query('INSERT IGNORE INTO payment_settings (id) VALUES (1)');
  await pool.query('INSERT IGNORE INTO general_settings (id) VALUES (1)');

  const userCount = (await pool.query('SELECT COUNT(*) AS c FROM users'))[0][0].c;
  if (userCount === 0) {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    await pool.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [
      'admin',
      passwordHash,
      'super_admin',
    ]);
    console.log('Seeded default admin user -> username: admin / password: admin123 (please change this)');
  }
}

const ready = setup();

module.exports = { prepare, transaction, exec, columnsOf, pool, ready };
