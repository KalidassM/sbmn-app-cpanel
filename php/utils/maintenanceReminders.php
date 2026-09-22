<?php

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DEFAULT_REMINDER_DAYS = '1,2,3,4,5,7,10';
const DEFAULT_REMINDER_TIME = '10:00';

function now_ist(): array
{
    $now = new DateTime('now', new DateTimeZone('Asia/Kolkata'));
    return [
        'year' => (int) $now->format('Y'),
        'month' => (int) $now->format('n'),
        'day' => (int) $now->format('j'),
        'hour' => (int) $now->format('G'),
        'minute' => (int) $now->format('i'),
    ];
}

function send_daily_reminders(bool $force = false): array
{
    if (!wa_is_connected()) {
        return ['skipped' => true, 'reason' => 'WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID.'];
    }

    $settings = db_get('SELECT reminders_last_sent_date, app_name, reminder_days, reminder_time FROM general_settings WHERE id = 1');

    $reminderDays = array_values(array_filter(array_map(
        fn ($d) => (int) trim($d),
        explode(',', $settings['reminder_days'] ?? DEFAULT_REMINDER_DAYS)
    ), fn ($d) => $d >= 1 && $d <= 31));
    [$reminderHour, $reminderMinute] = array_map('intval', explode(':', $settings['reminder_time'] ?? DEFAULT_REMINDER_TIME));

    $ist = now_ist();
    ['year' => $year, 'month' => $month, 'day' => $day, 'hour' => $hour, 'minute' => $minute] = $ist;

    if (!$force && !in_array($day, $reminderDays, true)) {
        return ['skipped' => true, 'reason' => 'Not a scheduled reminder day'];
    }
    if (!$force && $hour * 60 + $minute < $reminderHour * 60 + $reminderMinute) {
        return ['skipped' => true, 'reason' => "Scheduled for {$settings['reminder_time']} IST today - not yet time"];
    }

    $dateKey = sprintf('%04d-%02d-%02d', $year, $month, $day);
    if (!$force && ($settings['reminders_last_sent_date'] ?? null) === $dateKey) {
        return ['skipped' => true, 'reason' => "Already sent today ($dateKey)"];
    }

    ensure_dues_generated($month, $year);

    $dues = db_all(
        "SELECT mp.id, mp.amount_due, mp.amount_paid, mp.month, mp.year, m.name, m.phone, m.site_no
         FROM maintenance_payments mp
         JOIN members m ON m.id = mp.member_id
         WHERE mp.month = ? AND mp.year = ? AND mp.status != 'paid' AND m.status = 'active'",
        [$month, $year]
    );

    $sent = [];
    $failed = [];
    $skippedNoPhone = [];

    foreach ($dues as $due) {
        if (empty($due['phone']) || !preg_replace('/\D/', '', $due['phone'])) {
            $skippedNoPhone[] = $due['name'];
            db_run('UPDATE maintenance_payments SET last_reminder_error = ? WHERE id = ?', ['No phone number on file', $due['id']]);
            continue;
        }
        $remaining = (float) $due['amount_due'] - (float) $due['amount_paid'];
        $link = base_url() . '/pay-monthly-maintenance?q=' . urlencode($due['site_no'] ?: $due['name']);

        $message = "*Hi {$due['name']},*  This is a reminder that your maintenance due of *₹$remaining " .
            "for " . MONTH_NAMES[$due['month']] . " {$due['year']} (Site No " . ($due['site_no'] ?: '-') . ")* is still pending.\n\n" .
            "*Pay Now:* $link\n\n" . sign_off();
        try {
            wa_send_message($due['phone'], $message);
            $sent[] = $due['name'];
            db_run("UPDATE maintenance_payments SET last_reminder_sent_at = NOW(), last_reminder_error = NULL WHERE id = ?", [$due['id']]);
        } catch (Throwable $e) {
            $failed[] = ['name' => $due['name'], 'error' => $e->getMessage()];
            db_run('UPDATE maintenance_payments SET last_reminder_error = ? WHERE id = ?', [$e->getMessage(), $due['id']]);
        }
    }

    db_run('UPDATE general_settings SET reminders_last_sent_date = ? WHERE id = 1', [$dateKey]);

    return [
        'skipped' => false,
        'dateKey' => $dateKey,
        'totalDue' => count($dues),
        'sent' => $sent,
        'failed' => $failed,
        'skippedNoPhone' => $skippedNoPhone,
    ];
}
