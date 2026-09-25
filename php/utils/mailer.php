<?php
// Two interchangeable ways to send email, picked by general_settings.email_provider:
//  - 'resend' (default): Resend's HTTPS API - no mail server needed, good deliverability.
//  - 'smtp': the admin's own mailbox via php/utils/smtp.php - no third party involved, but
//    deliverability depends on that mailbox's own reputation.

const RESEND_DEFAULT_FROM = 'onboarding@resend.dev'; // Resend's shared sandbox sender - works with no domain verification

function mailer_settings(): ?array
{
    return db_get(
        "SELECT email_provider, resend_api_key, resend_from_email,
                smtp_host, smtp_port, smtp_username, smtp_password, smtp_secure, smtp_from_email
         FROM general_settings WHERE id = 1"
    );
}

function is_email_configured(): bool
{
    $s = mailer_settings();
    if (!$s) {
        return false;
    }
    if (($s['email_provider'] ?? 'resend') === 'smtp') {
        return !empty($s['smtp_host']) && !empty($s['smtp_username']) && !empty($s['smtp_password']);
    }
    return !empty($s['resend_api_key']);
}

function send_mail(string $to, string $subject, string $html): array
{
    $s = mailer_settings();
    $provider = $s['email_provider'] ?? 'resend';

    if ($provider === 'smtp') {
        smtp_send_mail($s, $to, $subject, $html);
        return ['ok' => true];
    }

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
