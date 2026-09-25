<?php

// razorpay_key_secret/sbiepay_secret_key must never leave the server
function payment_settings_public(array $row): array
{
    $secret = $row['razorpay_key_secret'] ?? null;
    $sbiSecret = $row['sbiepay_secret_key'] ?? null;
    unset($row['razorpay_key_secret'], $row['sbiepay_secret_key']);
    $row['razorpay_configured'] = !empty($row['razorpay_key_id']) && !empty($secret);
    $row['sbiepay_configured'] = !empty($row['sbiepay_merchant_id']) && !empty($sbiSecret);
    return $row;
}

Router::get('/payment-settings', function () {
    require_super_admin();
    Response::json(payment_settings_public(db_get('SELECT * FROM payment_settings WHERE id = 1')));
});

Router::put('/payment-settings', function ($params, $body) {
    $user = require_super_admin();
    $existing = db_get('SELECT * FROM payment_settings WHERE id = 1');

    $finalGatewayDisplay = $existing['gateway_display'];
    if (array_key_exists('gateway_display', $body)) {
        if (!in_array($body['gateway_display'], ['both', 'razorpay', 'sbiepay'], true)) {
            throw new ApiError(400, 'gateway_display must be "both", "razorpay" or "sbiepay"');
        }
        $finalGatewayDisplay = $body['gateway_display'];
    }

    db_run(
        'UPDATE payment_settings
         SET upi_id = ?, payee_name = ?, bank_name = ?, account_no = ?, ifsc_code = ?,
             razorpay_key_id = ?, razorpay_key_secret = ?, sbiepay_merchant_id = ?, sbiepay_secret_key = ?,
             gateway_display = ?, updated_at = NOW()
         WHERE id = 1',
        [
            // each field falls back to its existing value when omitted, so partial saves (e.g. the gateway-keys
            // form, which doesn't send upi_id/bank fields) don't blank out settings saved from another form
            array_key_exists('upi_id', $body) ? ($body['upi_id'] ?: null) : $existing['upi_id'],
            array_key_exists('payee_name', $body) ? ($body['payee_name'] ?: null) : $existing['payee_name'],
            array_key_exists('bank_name', $body) ? ($body['bank_name'] ?: null) : $existing['bank_name'],
            array_key_exists('account_no', $body) ? ($body['account_no'] ?: null) : $existing['account_no'],
            array_key_exists('ifsc_code', $body) ? ($body['ifsc_code'] ?: null) : $existing['ifsc_code'],
            array_key_exists('razorpay_key_id', $body) ? ($body['razorpay_key_id'] ?: null) : $existing['razorpay_key_id'],
            // blank/omitted secret keeps the existing one, so admins don't have to re-enter it every save
            !empty($body['razorpay_key_secret']) ? $body['razorpay_key_secret'] : $existing['razorpay_key_secret'],
            array_key_exists('sbiepay_merchant_id', $body) ? ($body['sbiepay_merchant_id'] ?: null) : $existing['sbiepay_merchant_id'],
            !empty($body['sbiepay_secret_key']) ? $body['sbiepay_secret_key'] : $existing['sbiepay_secret_key'],
            $finalGatewayDisplay,
        ]
    );
    $row = db_get('SELECT * FROM payment_settings WHERE id = 1');
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'payment_settings',
        'description' => 'Updated payment settings',
    ]);
    Response::json(payment_settings_public($row));
});

// Builds a UPI deep link for the configured account and renders it as a scannable QR code
Router::get('/payment-settings/qr', function ($params, $body, $query) {
    require_auth();
    try {
        Response::json(build_upi_qr((float) ($query['amount'] ?? 0), $query['note'] ?? null));
    } catch (Throwable $e) {
        throw new ApiError(400, $e->getMessage());
    }
});
