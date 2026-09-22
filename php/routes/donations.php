<?php

const DONATIONS_SELECT_JOIN = '
  SELECT d.*, m.name AS member_name, e.title AS event_title
  FROM donations d
  LEFT JOIN members m ON m.id = d.member_id
  LEFT JOIN events e ON e.id = d.event_id
';

Router::get('/donations', function () {
    require_auth();
    Response::json(db_all(DONATIONS_SELECT_JOIN . ' ORDER BY d.donation_date DESC, d.created_at DESC, d.id DESC'));
});

Router::post('/donations', function ($params, $body) {
    $user = require_admin();
    $amount = $body['amount'] ?? null;
    if ($amount === null || (empty($body['member_id']) && empty($body['donor_name']))) {
        throw new ApiError(400, 'amount and either member_id or donor_name are required');
    }
    $info = db_run(
        'INSERT INTO donations (member_id, donor_name, amount, donation_date, purpose, event_id)
         VALUES (?, ?, ?, COALESCE(?, CURDATE()), ?, ?)',
        [$body['member_id'] ?? null, $body['donor_name'] ?? null, $amount, $body['donation_date'] ?? null, $body['purpose'] ?? null, $body['event_id'] ?? null]
    );
    $row = db_get(DONATIONS_SELECT_JOIN . ' WHERE d.id = ?', [$info['insertId']]);
    notify_donation_whatsapp($row);
    log_activity([
        'actor' => $user['username'],
        'action' => 'create',
        'entityType' => 'donation',
        'entityId' => $row['id'],
        'description' => "Added donation of ₹{$row['amount']} from " . ($row['donor_name'] ?: ($row['member_name'] ?: 'member')),
    ]);
    Response::json($row, 201);
});

Router::put('/donations/:id', function ($params, $body) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM donations WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Donation not found');
    }
    db_run(
        'UPDATE donations SET member_id = ?, donor_name = ?, amount = ?, donation_date = ?, purpose = ?, event_id = ?
         WHERE id = ?',
        [
            array_key_exists('member_id', $body) ? $body['member_id'] : $existing['member_id'],
            array_key_exists('donor_name', $body) ? $body['donor_name'] : $existing['donor_name'],
            $body['amount'] ?? $existing['amount'],
            $body['donation_date'] ?? $existing['donation_date'],
            $body['purpose'] ?? $existing['purpose'],
            array_key_exists('event_id', $body) ? $body['event_id'] : $existing['event_id'],
            $params['id'],
        ]
    );
    $row = db_get(DONATIONS_SELECT_JOIN . ' WHERE d.id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'donation',
        'entityId' => $row['id'],
        'description' => "Updated donation of ₹{$row['amount']} from " . ($row['donor_name'] ?: ($row['member_name'] ?: 'member')),
    ]);
    Response::json($row);
});

Router::delete('/donations/:id', function ($params) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM donations WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Donation not found');
    }
    db_run('DELETE FROM donations WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'delete',
        'entityType' => 'donation',
        'entityId' => $existing['id'],
        'description' => "Deleted donation of ₹{$existing['amount']} from " . ($existing['donor_name'] ?: ('member ID ' . $existing['member_id'])),
    ]);
    Response::json(['ok' => true]);
});

// A logged-in member starts a donation for themselves; it stays 'pending' until paid online or confirmed by an admin (UPI QR path)
Router::post('/donations/self', function ($params, $body) {
    $user = require_auth();
    if (!$user['member_id']) {
        throw new ApiError(400, "Your login isn't linked to a member profile, so this can't be recorded as your own donation.");
    }
    $amount = $body['amount'] ?? null;
    if (!$amount || (float) $amount <= 0) {
        throw new ApiError(400, 'A valid amount is required');
    }
    $info = db_run(
        "INSERT INTO donations (member_id, amount, purpose, event_id, status, source)
         VALUES (?, ?, ?, ?, 'pending', 'member')",
        [$user['member_id'], $amount, $body['purpose'] ?? null, $body['event_id'] ?? null]
    );
    $row = db_get(DONATIONS_SELECT_JOIN . ' WHERE d.id = ?', [$info['insertId']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'create',
        'entityType' => 'donation',
        'entityId' => $row['id'],
        'description' => "Started self donation of ₹{$row['amount']} (pending payment)",
    ]);
    Response::json($row, 201);
});

function donations_load_own(int $donationId, array $user): array
{
    $donation = db_get("SELECT * FROM donations WHERE id = ? AND source = 'member'", [$donationId]);
    if (!$donation) {
        throw new ApiError(404, 'Donation not found');
    }
    if ((int) $donation['member_id'] !== (int) $user['member_id']) {
        throw new ApiError(403, 'You can only pay your own donation');
    }
    if ($donation['status'] !== 'pending') {
        throw new ApiError(400, 'This donation has already been completed');
    }
    return $donation;
}

Router::post('/donations/self/:id/order', function ($params) {
    $user = require_auth();
    if (!razorpay_is_configured()) {
        throw new ApiError(400, 'Online payments are not configured yet. Ask an admin to set up Razorpay in Payment Settings.');
    }
    $donation = donations_load_own((int) $params['id'], $user);

    $amountPaise = (int) round((float) $donation['amount'] * 100);
    try {
        $order = razorpay_create_order($amountPaise, "donation_{$donation['id']}", [
            'donation_id' => (string) $donation['id'],
            'member_id' => (string) $donation['member_id'],
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
        error_log('Razorpay order creation failed (self donation): ' . $e->getMessage());
        throw new ApiError(502, 'Could not reach Razorpay to create the order. Check the API keys in Payment Settings.');
    }
});

Router::post('/donations/self/:id/verify', function ($params, $body) {
    $user = require_auth();
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

    $donation = donations_load_own((int) $params['id'], $user);

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

    $row = db_get(DONATIONS_SELECT_JOIN . ' WHERE d.id = ?', [$donation['id']]);
    notify_donation_whatsapp($row);
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'donation',
        'entityId' => $row['id'],
        'description' => "Online payment verified for donation of ₹{$row['amount']} from " . ($row['donor_name'] ?: ($row['member_name'] ?: 'member')),
    ]);
    Response::json(['ok' => true, 'donation' => $row]);
});

// Admin reconciliation for donations paid via UPI QR (no automatic verification), whether from a member or a public well-wisher
Router::put('/donations/:id/confirm', function ($params) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM donations WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Donation not found');
    }
    if ($existing['status'] !== 'pending') {
        throw new ApiError(400, 'This donation is already completed');
    }
    db_run("UPDATE donations SET status = 'completed', donation_date = CURDATE() WHERE id = ?", [$params['id']]);
    $row = db_get(DONATIONS_SELECT_JOIN . ' WHERE d.id = ?', [$params['id']]);
    notify_donation_whatsapp($row);
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'donation',
        'entityId' => $row['id'],
        'description' => "Confirmed UPI donation of ₹{$row['amount']} from " . ($row['donor_name'] ?: ($row['member_name'] ?: 'member')),
    ]);
    Response::json($row);
});
