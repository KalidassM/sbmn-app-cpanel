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

// Sends a WhatsApp message to a member. Never throws - a notification failure (WhatsApp not
// configured, no/bad phone on file, etc.) must not break the member create/status-change request
// that triggered it.
function notify_member(array $member, string $text): void
{
    try {
        if (empty($member['phone']) || !wa_is_connected()) {
            return;
        }
        wa_send_message($member['phone'], $text);
    } catch (Throwable $e) {
        error_log('Member WhatsApp notification failed: ' . $e->getMessage());
    }
}
