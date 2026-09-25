<?php

// resend_api_key/smtp_password must never leave the server - only expose whether email sending
// is set up for whichever provider is currently selected.
function general_settings_public(array $row): array
{
    $smtpPassword = $row['smtp_password'] ?? null;
    unset($row['resend_api_key'], $row['smtp_password']);
    $row['email_configured'] = is_email_configured();
    $row['smtp_password_set'] = !empty($smtpPassword);
    return $row;
}

Router::get('/general-settings', function () {
    require_auth();
    Response::json(general_settings_public(db_get('SELECT * FROM general_settings WHERE id = 1')));
});

Router::put('/general-settings', function ($params, $body) {
    require_super_admin();
    $existing = db_get('SELECT * FROM general_settings WHERE id = 1');

    $finalMaintenanceAmount = $existing['maintenance_amount'];
    if (array_key_exists('maintenance_amount', $body)) {
        if (!is_numeric($body['maintenance_amount']) || (float) $body['maintenance_amount'] <= 0) {
            throw new ApiError(400, 'A valid maintenance amount is required');
        }
        $finalMaintenanceAmount = (float) $body['maintenance_amount'];
    }

    $finalReminderDays = $existing['reminder_days'];
    if (array_key_exists('reminder_days', $body)) {
        $days = array_values(array_unique(array_filter(array_map(
            fn ($d) => (int) trim($d),
            explode(',', (string) $body['reminder_days'])
        ), fn ($d) => $d >= 1 && $d <= 31)));
        if (!$days) {
            throw new ApiError(400, 'Pick at least one reminder day');
        }
        sort($days);
        $finalReminderDays = implode(',', $days);
    }

    $finalReminderTime = $existing['reminder_time'];
    if (array_key_exists('reminder_time', $body)) {
        if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $body['reminder_time'])) {
            throw new ApiError(400, 'Reminder time must be in HH:MM format');
        }
        $finalReminderTime = $body['reminder_time'];
    }

    $finalReminderChannels = $existing['reminder_channels'];
    if (array_key_exists('reminder_channels', $body)) {
        $channels = array_values(array_unique(array_intersect(
            array_map('trim', explode(',', (string) $body['reminder_channels'])),
            ['whatsapp', 'email']
        )));
        if (!$channels) {
            throw new ApiError(400, 'Pick at least one reminder channel (WhatsApp or Email)');
        }
        $finalReminderChannels = implode(',', $channels);
    }

    $finalEmailProvider = $existing['email_provider'];
    if (array_key_exists('email_provider', $body)) {
        if (!in_array($body['email_provider'], ['resend', 'smtp'], true)) {
            throw new ApiError(400, 'email_provider must be "resend" or "smtp"');
        }
        $finalEmailProvider = $body['email_provider'];
    }

    $finalSmtpSecure = $existing['smtp_secure'];
    if (array_key_exists('smtp_secure', $body)) {
        if (!in_array($body['smtp_secure'], ['ssl', 'tls', 'none'], true)) {
            throw new ApiError(400, 'smtp_secure must be "ssl", "tls" or "none"');
        }
        $finalSmtpSecure = $body['smtp_secure'];
    }

    db_run(
        'UPDATE general_settings SET
           maintenance_amount = ?,
           app_name = ?, contact_email = ?, office_address = ?, office_hours = ?, phone_number = ?,
           resend_api_key = ?, resend_from_email = ?, reminder_days = ?, reminder_time = ?, reminder_channels = ?,
           email_provider = ?, smtp_host = ?, smtp_port = ?, smtp_username = ?, smtp_password = ?, smtp_secure = ?, smtp_from_email = ?,
           updated_at = NOW()
         WHERE id = 1',
        [
            $finalMaintenanceAmount,
            array_key_exists('app_name', $body) ? ($body['app_name'] ?: null) : $existing['app_name'],
            array_key_exists('contact_email', $body) ? ($body['contact_email'] ?: null) : $existing['contact_email'],
            array_key_exists('office_address', $body) ? ($body['office_address'] ?: null) : $existing['office_address'],
            array_key_exists('office_hours', $body) ? ($body['office_hours'] ?: null) : $existing['office_hours'],
            array_key_exists('phone_number', $body) ? ($body['phone_number'] ?: null) : $existing['phone_number'],
            // blank/omitted key/password keeps the existing one, so admins don't have to re-enter it every save
            !empty($body['resend_api_key']) ? $body['resend_api_key'] : $existing['resend_api_key'],
            array_key_exists('resend_from_email', $body) ? ($body['resend_from_email'] ?: null) : $existing['resend_from_email'],
            $finalReminderDays,
            $finalReminderTime,
            $finalReminderChannels,
            $finalEmailProvider,
            array_key_exists('smtp_host', $body) ? ($body['smtp_host'] ?: null) : $existing['smtp_host'],
            array_key_exists('smtp_port', $body) ? ($body['smtp_port'] ?: null) : $existing['smtp_port'],
            array_key_exists('smtp_username', $body) ? ($body['smtp_username'] ?: null) : $existing['smtp_username'],
            !empty($body['smtp_password']) ? $body['smtp_password'] : $existing['smtp_password'],
            $finalSmtpSecure,
            array_key_exists('smtp_from_email', $body) ? ($body['smtp_from_email'] ?: null) : $existing['smtp_from_email'],
        ]
    );
    $row = db_get('SELECT * FROM general_settings WHERE id = 1');
    log_activity([
        'actor' => require_auth()['username'],
        'action' => 'update',
        'entityType' => 'general_settings',
        'description' => 'Updated general settings',
    ]);
    Response::json(general_settings_public($row));
});

Router::post('/general-settings/test-email', function () {
    require_super_admin();
    $settings = db_get('SELECT contact_email FROM general_settings WHERE id = 1');
    $to = $settings['contact_email'] ?? null;
    if (!$to) {
        throw new ApiError(400, 'Set a Contact Email in General Settings first');
    }
    try {
        send_mail($to, 'SBMN App - Test Email', "<p>This is a test email from your SBMN app's General Settings. If you received this, email sending is working correctly.</p>");
        Response::json(['ok' => true, 'to' => $to]);
    } catch (Throwable $e) {
        throw new ApiError(502, $e->getMessage());
    }
});
