<?php

const PUBLIC_DONATIONS_MAX_AMOUNT = 1000000;

function public_donations_load_pending(int $donationId): array
{
    $donation = db_get("SELECT * FROM donations WHERE id = ? AND source = 'public'", [$donationId]);
    if (!$donation) {
        throw new ApiError(404, 'Donation not found');
    }
    if ($donation['status'] !== 'pending') {
        throw new ApiError(400, 'This donation has already been completed');
    }
    return $donation;
}

// No auth on this router — well-wishers have no account. Only exposes what's needed to record and pay a donation.
Router::post('/public/donations', function ($params, $body) {
    $name = trim((string) ($body['donor_name'] ?? ''));
    $amount = $body['amount'] ?? null;
    if (!$name) {
        throw new ApiError(400, 'Your name is required');
    }
    if (!$amount || (float) $amount <= 0 || (float) $amount > PUBLIC_DONATIONS_MAX_AMOUNT) {
        throw new ApiError(400, 'A valid amount is required');
    }
    $purpose = $body['purpose'] ?? null;
    $info = db_run(
        "INSERT INTO donations (donor_name, donor_email, donor_phone, amount, purpose, status, source)
         VALUES (?, ?, ?, ?, ?, 'pending', 'public')",
        [
            mb_substr($name, 0, 120),
            mb_substr(trim((string) ($body['donor_email'] ?? '')), 0, 160) ?: null,
            mb_substr(trim((string) ($body['donor_phone'] ?? '')), 0, 32) ?: null,
            $amount,
            mb_substr(trim((string) ($purpose ?? '')), 0, 200) ?: null,
        ]
    );
    log_activity([
        'actor' => 'public',
        'action' => 'create',
        'entityType' => 'donation',
        'entityId' => $info['insertId'],
        'description' => "$name pledged a donation of ₹" . (float) $amount . ($purpose ? " for $purpose" : ''),
    ]);
    Response::json(['id' => $info['insertId'], 'donor_name' => $name, 'amount' => (float) $amount], 201);
});

Router::get('/public/donations/razorpay-config', function () {
    $settings = razorpay_gateway_settings();
    Response::json([
        'configured' => !empty($settings['razorpay_key_id']) && !empty($settings['razorpay_key_secret']),
        'keyId' => $settings['razorpay_key_id'] ?: null,
    ]);
});

Router::get('/public/donations/qr', function ($params, $body, $query) {
    try {
        Response::json(build_upi_qr((float) ($query['amount'] ?? 0), $query['note'] ?? null));
    } catch (Throwable $e) {
        throw new ApiError(400, $e->getMessage());
    }
});

Router::post('/public/donations/:id/order', function ($params) {
    if (!razorpay_is_configured()) {
        throw new ApiError(400, 'Online payments are not configured yet. Please use the UPI QR code instead.');
    }
    $donation = public_donations_load_pending((int) $params['id']);

    $amountPaise = (int) round((float) $donation['amount'] * 100);
    try {
        $order = razorpay_create_order($amountPaise, "donation_{$donation['id']}", [
            'donation_id' => (string) $donation['id'],
            'donor_name' => $donation['donor_name'] ?: '',
        ]);
        db_run('UPDATE donations SET razorpay_order_id = ? WHERE id = ?', [$order['id'], $donation['id']]);
        $settings = razorpay_gateway_settings();
        Response::json([
            'orderId' => $order['id'],
            'amount' => $amountPaise,
            'currency' => $order['currency'],
            'keyId' => $settings['razorpay_key_id'],
            'payeeName' => $settings['payee_name'] ?: 'Sri Balamurugan Nagar Welfare Association',
        ]);
    } catch (Throwable $e) {
        error_log('Razorpay order creation failed (public donation): ' . $e->getMessage());
        throw new ApiError(502, 'Could not reach Razorpay to create the order. Please try the UPI QR code instead.');
    }
});

Router::post('/public/donations/:id/verify', function ($params, $body) {
    $orderId = $body['razorpay_order_id'] ?? null;
    $paymentId = $body['razorpay_payment_id'] ?? null;
    $signature = $body['razorpay_signature'] ?? null;
    if (!$orderId || !$paymentId || !$signature) {
        throw new ApiError(400, 'Missing payment verification fields');
    }

    $settings = razorpay_gateway_settings();
    if (empty($settings['razorpay_key_secret'])) {
        throw new ApiError(400, 'Online payments are not configured');
    }

    $donation = public_donations_load_pending((int) $params['id']);

    if ($donation['razorpay_order_id'] !== $orderId) {
        throw new ApiError(400, 'Order does not match this donation');
    }
    if (!razorpay_verify_signature($orderId, $paymentId, $signature, $settings['razorpay_key_secret'])) {
        throw new ApiError(400, 'Payment signature verification failed');
    }

    db_run(
        "UPDATE donations SET status = 'completed', razorpay_payment_id = ?, donation_date = CURDATE() WHERE id = ?",
        [$paymentId, $donation['id']]
    );

    notify_donation_whatsapp($donation);
    log_activity([
        'actor' => 'public',
        'action' => 'payment',
        'entityType' => 'donation',
        'entityId' => $donation['id'],
        'description' => "{$donation['donor_name']} paid ₹{$donation['amount']} donation online" . (!empty($donation['purpose']) ? " for {$donation['purpose']}" : ''),
    ]);
    Response::json(['ok' => true]);
});
