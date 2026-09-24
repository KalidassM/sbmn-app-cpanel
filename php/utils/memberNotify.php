<?php

function app_name(): string
{
    $settings = db_get('SELECT app_name FROM general_settings WHERE id = 1');
    return $settings['app_name'] ?? 'the Association';
}

// Appended to every outbound WhatsApp message as a consistent branded sign-off.
function sign_off(): string
{
    return '~ *' . app_name() . '* ~';
}

function welcome_message(array $member): string
{
    $siteBit = !empty($member['site_no']) ? " (Site No {$member['site_no']})" : '';
    return "Welcome {$member['name']}! You've been added as a member of " . app_name() . "$siteBit. We're glad to have you with us. Visit the portal: " . portal_url() . "\n\n" . sign_off();
}

// Reuses the WhatsApp-style plain text as the email body too, instead of writing separate copy
// for every message - good enough for these short transactional notices.
function text_to_html(string $text): string
{
    return '<p>' . nl2br(htmlspecialchars($text)) . '</p>';
}

// Sends a message to a member over every channel that's actually usable: WhatsApp if configured
// and a phone is on file, email if Resend is configured and an email is on file. Both are
// independent and best-effort - one channel failing (or not being set up) never blocks the other,
// and this never throws, so a notification failure must not break the request that triggered it.
function notify_member(array $member, string $text, ?string $emailSubject = null): void
{
    if (!empty($member['phone']) && wa_is_connected()) {
        try {
            wa_send_message($member['phone'], $text);
        } catch (Throwable $e) {
            error_log('Member WhatsApp notification failed: ' . $e->getMessage());
        }
    }

    if ($emailSubject && !empty($member['email']) && is_email_configured()) {
        try {
            send_mail($member['email'], $emailSubject, text_to_html($text));
        } catch (Throwable $e) {
            error_log('Member email notification failed: ' . $e->getMessage());
        }
    }
}
