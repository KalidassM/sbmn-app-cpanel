<?php
// Records an action for the admin Activity Log page. Never throws - a logging failure must
// not break the mutation that triggered it. `actor` is typically the current user's username,
// or 'public' for unauthenticated member-facing routes, or 'system' for background jobs.
function log_activity(array $opts): void
{
    try {
        db_run(
            'INSERT INTO activity_log (actor, action, entity_type, entity_id, description) VALUES (?, ?, ?, ?, ?)',
            [
                $opts['actor'] ?? 'unknown',
                $opts['action'],
                $opts['entityType'],
                $opts['entityId'] ?? null,
                $opts['description'],
            ]
        );
    } catch (Throwable $e) {
        error_log('Activity log write failed: ' . $e->getMessage());
    }
}
