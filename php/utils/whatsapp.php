<?php
// WhatsApp Business Cloud API (Meta Graph API) client - credential-based (WHATSAPP_ACCESS_TOKEN /
// WHATSAPP_PHONE_NUMBER_ID env vars), no persistent connection/session needed, unlike the old
// Baileys-based Node app this replaced.
//
// IMPORTANT - Meta's 24-hour session window: wa_send_message() sends freeform text, which only
// delivers if the recipient has messaged this WhatsApp Business number within the last 24 hours.
// Business-initiated messages outside that window (dues reminders, welcome messages, payment
// confirmations, forgot-password codes) need a pre-approved Message Template instead - see
// wa_send_template().

function wa_is_configured(): bool
{
    return (bool) (env('WHATSAPP_ACCESS_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID'));
}

function wa_is_connected(): bool
{
    return wa_is_configured();
}

function wa_to_numbers(?string $phone): array
{
    if (!$phone) {
        return [];
    }
    $candidates = preg_split('#[/,]|\s+(?:or|and)\s+#i', $phone);
    $numbers = [];
    foreach ($candidates as $candidate) {
        $digits = preg_replace('/\D/', '', $candidate);
        if (strlen($digits) >= 10) {
            $numbers[strlen($digits) === 10 ? "91$digits" : $digits] = true;
        }
    }
    return array_keys($numbers);
}

function wa_graph_call(array $payload): array
{
    $version = env('WHATSAPP_GRAPH_API_VERSION', 'v20.0');
    $phoneNumberId = env('WHATSAPP_PHONE_NUMBER_ID');
    $ch = curl_init("https://graph.facebook.com/$version/$phoneNumberId/messages");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . env('WHATSAPP_ACCESS_TOKEN'),
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
    ]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($status < 200 || $status >= 300) {
        throw new RuntimeException("WhatsApp API error ($status): " . ($body ?: 'unknown'));
    }
    return json_decode($body, true) ?? [];
}

function wa_send_message(?string $phone, string $text): void
{
    if (!wa_is_configured()) {
        throw new RuntimeException('WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.');
    }
    $numbers = wa_to_numbers($phone);
    if (!$numbers) {
        throw new RuntimeException('No valid phone number on file');
    }
    foreach ($numbers as $to) {
        wa_graph_call([
            'messaging_product' => 'whatsapp',
            'to' => $to,
            'type' => 'text',
            'text' => ['body' => $text, 'preview_url' => false],
        ]);
    }
}

// Pre-approved Message Template send, required for business-initiated messages outside the
// 24-hour window. $params fills the template's {{1}}, {{2}}... body placeholders in order.
function wa_send_template(?string $phone, string $templateName, string $languageCode, array $params = []): void
{
    if (!wa_is_configured()) {
        throw new RuntimeException('WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.');
    }
    $numbers = wa_to_numbers($phone);
    if (!$numbers) {
        throw new RuntimeException('No valid phone number on file');
    }
    $components = $params ? [[
        'type' => 'body',
        'parameters' => array_map(fn ($text) => ['type' => 'text', 'text' => (string) $text], $params),
    ]] : [];
    foreach ($numbers as $to) {
        wa_graph_call([
            'messaging_product' => 'whatsapp',
            'to' => $to,
            'type' => 'template',
            'template' => ['name' => $templateName, 'language' => ['code' => $languageCode], 'components' => $components],
        ]);
    }
}
