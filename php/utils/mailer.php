<?php
// Sends email via Resend's HTTPS API (https://api.resend.com) rather than raw SMTP.

const RESEND_DEFAULT_FROM = 'onboarding@resend.dev'; // Resend's shared sandbox sender - works with no domain verification

function mailer_settings(): ?array
{
    return db_get('SELECT resend_api_key, resend_from_email FROM general_settings WHERE id = 1');
}

function is_email_configured(): bool
{
    $s = mailer_settings();
    return !empty($s['resend_api_key']);
}

function send_mail(string $to, string $subject, string $html): array
{
    $s = mailer_settings();
    if (empty($s['resend_api_key'])) {
        throw new RuntimeException('Email sending is not configured yet. Add a Resend API key in General Settings.');
    }

    $ch = curl_init('https://api.resend.com/emails');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $s['resend_api_key'],
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode([
            'from' => $s['resend_from_email'] ?: RESEND_DEFAULT_FROM,
            'to' => $to,
            'subject' => $subject,
            'html' => $html,
        ]),
    ]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $data = json_decode($body ?: 'null', true);
    if ($status < 200 || $status >= 300) {
        throw new RuntimeException(($data['message'] ?? null) ?: "Resend API request failed ($status)");
    }
    return $data ?? [];
}
