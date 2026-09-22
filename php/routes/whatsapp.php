<?php

// Read by the General Settings page - there's no QR/session to poll here (Cloud API is
// credential-based, not a linked device), just whether WHATSAPP_ACCESS_TOKEN /
// WHATSAPP_PHONE_NUMBER_ID are set on the server.
Router::get('/whatsapp/status', function () {
    require_admin();
    Response::json(['status' => wa_is_connected() ? 'connected' : 'disconnected']);
});

// Sends a single one-off message to a phone number of the admin's choosing - lets them confirm
// delivery actually works before the automatic monthly-dues reminder ever touches real members.
// Note: this uses a freeform text message, which Meta only delivers if that phone number has
// messaged this WhatsApp Business number within the last 24 hours (see php/utils/whatsapp.php).
Router::post('/whatsapp/test', function ($params, $body) {
    require_admin();
    $phone = trim((string) ($body['phone'] ?? ''));
    if (!$phone) {
        throw new ApiError(400, 'Enter a phone number');
    }
    try {
        wa_send_message($phone, "This is a test message from your SBMN app. If you received this, WhatsApp is configured correctly.\n\n" . sign_off());
        Response::json(['ok' => true]);
    } catch (Throwable $e) {
        throw new ApiError(502, $e->getMessage());
    }
});
