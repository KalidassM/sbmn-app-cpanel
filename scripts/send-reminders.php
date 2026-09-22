<?php
// cPanel Cron Job entry point - schedule every 5-15 minutes, e.g.:
//   */10 * * * * /usr/local/bin/php /home/youruser/sbmn-app-cpanel/scripts/send-reminders.php
// send_daily_reminders() is idempotent (guards on general_settings.reminders_last_sent_date), so
// a frequent check is safe - it self-heals if a run is missed, and never double-sends same-day.
require_once __DIR__ . '/../php/bootstrap.php';

try {
    $result = send_daily_reminders();
    if (empty($result['skipped'])) {
        echo "Maintenance reminders ({$result['dateKey']}): sent " . count($result['sent']) . "/{$result['totalDue']}, "
            . count($result['failed']) . ' failed, ' . count($result['skippedNoPhone']) . " skipped (no phone)\n";
    } else {
        echo "Skipped: {$result['reason']}\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'Daily reminder check failed: ' . $e->getMessage() . "\n");
    exit(1);
}
