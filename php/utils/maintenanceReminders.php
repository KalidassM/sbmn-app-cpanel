<?php

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DEFAULT_REMINDER_DAYS = '1,2,3,4,5,7,10';
const DEFAULT_REMINDER_TIME = '10:00';
const DEFAULT_REMINDER_CHANNELS = 'whatsapp,email';

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

// Which channel(s) the admin picked in General Settings, narrowed to what's actually configured
// on the server - picking "WhatsApp" there doesn't help if no access token is set.
function reminder_channels_enabled(): array
{
    $settings = db_get('SELECT reminder_channels FROM general_settings WHERE id = 1');
    $channels = array_map('trim', explode(',', $settings['reminder_channels'] ?? DEFAULT_REMINDER_CHANNELS));
    return [
        'whatsapp' => in_array('whatsapp', $channels, true) && wa_is_connected(),
        'email' => in_array('email', $channels, true) && is_email_configured(),
    ];
}

function build_reminder_message(array $due): string
{
    $remaining = (float) $due['amount_due'] - (float) $due['amount_paid'];
    $link = base_url() . '/pay-monthly-maintenance?q=' . urlencode($due['site_no'] ?: $due['name']);

    return "*Hi {$due['name']},*  This is a reminder that your maintenance due of *₹$remaining " .
        'for ' . MONTH_NAMES[$due['month']] . " {$due['year']} (Site No " . ($due['site_no'] ?: '-') . ")* is still pending.\n\n" .
        "*Pay Now:* $link\n\n" . sign_off();
}

// Sends (or attempts to) one due's reminder over whichever of WhatsApp/email are both enabled
// and reachable for this member, updates last_reminder_sent_at/last_reminder_error on the due
// row, and returns ['sent' => bool, 'error' => ?string]. Shared by the daily bulk sweep and the
// admin's single-member "send now" action, so both stay in sync.
function send_reminder_for_due(array $due, bool $useWhatsApp, bool $useEmail): array
{
    $canWhatsApp = $useWhatsApp && !empty($due['phone']) && preg_replace('/\D/', '', $due['phone']);
    $canEmail = $useEmail && !empty($due['email']);
    if (!$canWhatsApp && !$canEmail) {
        $error = 'No phone/email reachable via the selected reminder channel(s)';
        db_run('UPDATE maintenance_payments SET last_reminder_error = ? WHERE id = ?', [$error, $due['id']]);
        return ['sent' => false, 'error' => $error];
    }

    $message = build_reminder_message($due);
    $anySent = false;
    $lastError = null;

    if ($canWhatsApp) {
        try {
            wa_send_message($due['phone'], $message);
            $anySent = true;
        } catch (Throwable $e) {
            $lastError = $e->getMessage();
        }
    }
    if ($canEmail) {
        try {
            send_mail($due['email'], 'Maintenance due reminder - ' . app_name(), text_to_html($message));
            $anySent = true;
        } catch (Throwable $e) {
            $lastError = $lastError ? "$lastError; {$e->getMessage()}" : $e->getMessage();
        }
    }

    if ($anySent) {
        db_run("UPDATE maintenance_payments SET last_reminder_sent_at = NOW(), last_reminder_error = NULL WHERE id = ?", [$due['id']]);
        return ['sent' => true, 'error' => null];
    }
    $error = $lastError ?? 'No channel could send';
    db_run('UPDATE maintenance_payments SET last_reminder_error = ? WHERE id = ?', [$error, $due['id']]);
    return ['sent' => false, 'error' => $error];
}

// Admin's single-member "send now" action, bypassing the day/time/already-sent-today guards
// (unlike send_daily_reminders() below) - always sends when called, subject only to the due
// existing, not being already paid, and having a reachable channel.
function send_single_reminder(int $dueId): array
{
    $due = db_get(
        "SELECT mp.id, mp.amount_due, mp.amount_paid, mp.month, mp.year, mp.status, m.name, m.phone, m.email, m.site_no
         FROM maintenance_payments mp
         JOIN members m ON m.id = mp.member_id
         WHERE mp.id = ?",
        [$dueId]
    );
    if (!$due) {
        throw new ApiError(404, 'Due record not found');
    }
    if ($due['status'] === 'paid') {
        throw new ApiError(400, 'This due is already fully paid');
    }

    $channels = reminder_channels_enabled();
    if (!$channels['whatsapp'] && !$channels['email']) {
        throw new ApiError(400, 'No reminder channel is both selected in General Settings and configured on the server.');
    }

    return array_merge(['name' => $due['name']], send_reminder_for_due($due, $channels['whatsapp'], $channels['email']));
}

function send_daily_reminders(bool $force = false): array
{
    $settings = db_get('SELECT reminders_last_sent_date, app_name, reminder_days, reminder_time FROM general_settings WHERE id = 1');
    $channels = reminder_channels_enabled();
    if (!$channels['whatsapp'] && !$channels['email']) {
        return ['skipped' => true, 'reason' => 'No reminder channel is both selected in General Settings and configured on the server.'];
    }

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
        "SELECT mp.id, mp.amount_due, mp.amount_paid, mp.month, mp.year, m.name, m.phone, m.email, m.site_no
         FROM maintenance_payments mp
         JOIN members m ON m.id = mp.member_id
         WHERE mp.month = ? AND mp.year = ? AND mp.status != 'paid' AND m.status = 'active'",
        [$month, $year]
    );

    $sent = [];
    $failed = [];
    $skippedNoPhone = [];

    foreach ($dues as $due) {
        $result = send_reminder_for_due($due, $channels['whatsapp'], $channels['email']);
        if ($result['sent']) {
            $sent[] = $due['name'];
        } elseif ($result['error'] === 'No phone/email reachable via the selected reminder channel(s)') {
            $skippedNoPhone[] = $due['name'];
        } else {
            $failed[] = ['name' => $due['name'], 'error' => $result['error']];
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
