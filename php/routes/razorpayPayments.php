<?php

function razorpay_payments_load_due(int $paymentId, array $user): array
{
    $due = db_get('SELECT * FROM maintenance_payments WHERE id = ?', [$paymentId]);
    if (!$due) {
        throw new ApiError(404, 'Due record not found');
    }
    if (!in_array($user['role'], ['admin', 'super_admin'], true) && (int) $due['member_id'] !== (int) $user['member_id']) {
        throw new ApiError(403, 'You can only pay your own dues');
    }
    if ($due['status'] === 'paid') {
        throw new ApiError(400, 'This due is already fully paid');
    }
    return $due;
}

Router::get('/payments/razorpay/config', function () {
    require_auth();
    $settings = razorpay_gateway_settings();
    Response::json([
        'configured' => !empty($settings['razorpay_key_id']) && !empty($settings['razorpay_key_secret']),
        'keyId' => $settings['razorpay_key_id'] ?: null,
    ]);
});

Router::post('/payments/razorpay/order', function ($params, $body) {
    $user = require_auth();
    $paymentId = $body['payment_id'] ?? null;
    if (!$paymentId) {
        throw new ApiError(400, 'payment_id is required');
    }

    if (!razorpay_is_configured()) {
        throw new ApiError(400, 'Online payments are not configured yet. Ask an admin to set up Razorpay in Payment Settings.');
    }

    $due = razorpay_payments_load_due((int) $paymentId, $user);

    $remaining = (float) $due['amount_due'] - (float) $due['amount_paid'];
    $amountPaise = (int) round($remaining * 100);

    try {
        $order = razorpay_create_order($amountPaise, "due_{$due['id']}", [
            'maintenance_payment_id' => (string) $due['id'],
            'member_id' => (string) $due['member_id'],
        ]);
        db_run('UPDATE maintenance_payments SET razorpay_order_id = ? WHERE id = ?', [$order['id'], $due['id']]);
        $settings = razorpay_gateway_settings();
        Response::json([
            'orderId' => $order['id'],
            'amount' => $amountPaise,
            'currency' => $order['currency'],
            'keyId' => $settings['razorpay_key_id'],
            'payeeName' => $settings['payee_name'] ?: 'Sri Balamurugan Nagar Welfare Association',
        ]);
    } catch (Throwable $e) {
        error_log('Razorpay order creation failed (maintenance due): ' . $e->getMessage());
        throw new ApiError(502, 'Could not reach Razorpay to create the order. Check the API keys in Payment Settings.');
    }
});

Router::post('/payments/razorpay/verify', function ($params, $body) {
    $user = require_auth();
    $paymentId = $body['payment_id'] ?? null;
    $orderId = $body['razorpay_order_id'] ?? null;
    $razorpayPaymentId = $body['razorpay_payment_id'] ?? null;
    $signature = $body['razorpay_signature'] ?? null;
    if (!$paymentId || !$orderId || !$razorpayPaymentId || !$signature) {
        throw new ApiError(400, 'Missing payment verification fields');
    }

    $settings = razorpay_gateway_settings();
    if (empty($settings['razorpay_key_secret'])) {
        throw new ApiError(400, 'Online payments are not configured');
    }

    $due = razorpay_payments_load_due((int) $paymentId, $user);

    if ($due['razorpay_order_id'] !== $orderId) {
        throw new ApiError(400, 'Order does not match this due');
    }

    if (!razorpay_verify_signature($orderId, $razorpayPaymentId, $signature, $settings['razorpay_key_secret'])) {
        throw new ApiError(400, 'Payment signature verification failed');
    }

    db_run(
        "UPDATE maintenance_payments
         SET amount_paid = amount_due, status = 'paid', paid_date = CURDATE(), paid_at = NOW(), razorpay_payment_id = ?,
             payment_mode = 'Razorpay', reference_no = ?
         WHERE id = ?",
        [$razorpayPaymentId, $razorpayPaymentId, $due['id']]
    );

    $updated = db_get('SELECT * FROM maintenance_payments WHERE id = ?', [$due['id']]);
    notify_admin_of_payment($updated);
    notify_payment_whatsapp([$updated]);
    $member = db_get('SELECT name, site_no FROM members WHERE id = ?', [$updated['member_id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'payment',
        'entityType' => 'maintenance_payment',
        'entityId' => $updated['id'],
        'description' => ($member['name'] ?? 'Member') . ' (Site No ' . ($member['site_no'] ?? '-') . ") paid ₹{$updated['amount_paid']} online for {$updated['month']}/{$updated['year']}",
    ]);
    Response::json(['ok' => true, 'payment' => $updated]);
});
