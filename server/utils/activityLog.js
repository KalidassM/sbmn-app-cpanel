const db = require('../db');

const insertStmt = db.prepare(
  `INSERT INTO activity_log (actor, action, entity_type, entity_id, description) VALUES (?, ?, ?, ?, ?)`
);

// Records an action for the admin Activity Log page. Never throws - a logging failure must
// not break the mutation that triggered it. `actor` is typically req.user?.username, or
// 'public' for unauthenticated member-facing routes, or 'system' for background jobs.
async function logActivity({ actor, action, entityType, entityId = null, description }) {
  try {
    await insertStmt.run(actor || 'unknown', action, entityType, entityId, description);
  } catch (err) {
    console.error('Activity log write failed:', err.message);
  }
}

module.exports = { logActivity };
