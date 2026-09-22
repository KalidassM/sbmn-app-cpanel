<?php

// Dues from before this month are old arrears predating what should be collected through this
// public page - members with older pending dues pay those offline/through the admin instead.
const PUBLIC_MAINTENANCE_OLDEST_YEAR = 2026;
const PUBLIC_MAINTENANCE_OLDEST_MONTH = 6;

// An exact Site No match is unambiguous; otherwise fall back to a name search (min 3 chars, capped) to avoid scraping the member list
function public_maintenance_find_members(?string $query): array
{
    $q = trim((string) $query);
    if (!$q) {
        return [];
    }
    // No COLLATE NOCASE needed - the table's utf8mb4_general_ci collation is already case-insensitive.
    $bySiteNo = db_get('SELECT id, name, site_no, status FROM members WHERE site_no = ?', [$q]);
    if ($bySiteNo) {
        return [$bySiteNo];
    }
    if (mb_strlen($q) < 3) {
        return [];
    }
    return db_all('SELECT id, name, site_no, status FROM members WHERE name LIKE ? LIMIT 10', ["%$q%"]);
}

Router::get('/public/maintenance/dues', function ($params, $body, $query) {
    $members = public_maintenance_find_members($query['q'] ?? null);
    $currentMonth = (int) (new DateTime())->format('n');
    $currentYear = (int) (new DateTime())->format('Y');
    $activeMembers = array_filter($members, fn ($m) => $m['status'] === 'active');
    if ($activeMembers) {
        ensure_dues_generated($currentMonth, $currentYear);
    }
    $results = [];
    foreach ($members as $m) {
        if ($m['status'] !== 'active') {
            // Inactive members can't pay online here - no dues are surfaced, just the member/site so
            // the client can show a plain "you're not an active member" message instead of a due list.
            $results[] = ['member_id' => $m['id'], 'name' => $m['name'], 'site_no' => $m['site_no'], 'inactive' => true, 'dues' => []];
            continue;
        }
        // Show the current month plus any missed past months (arrears) - never a future month's due,
        // and never anything older than PUBLIC_MAINTENANCE_OLDEST_YEAR/MONTH (those arrears are
        // handled outside this public page).
        $dues = db_all(
            'SELECT id, month, year, amount_due, amount_paid, status FROM maintenance_payments
             WHERE member_id = ? AND status != \'paid\'
               AND (year > ? OR (year = ? AND month >= ?))
               AND (year < ? OR (year = ? AND month <= ?))
             ORDER BY year, month',
            [$m['id'], PUBLIC_MAINTENANCE_OLDEST_YEAR, PUBLIC_MAINTENANCE_OLDEST_YEAR, PUBLIC_MAINTENANCE_OLDEST_MONTH, $currentYear, $currentYear, $currentMonth]
        );
        $results[] = ['member_id' => $m['id'], 'name' => $m['name'], 'site_no' => $m['site_no'], 'inactive' => false, 'dues' => $dues];
    }
    Response::json($results);
});

const PUBLIC_MAINTENANCE_INACTIVE_MESSAGE = "You're not an active member, so this due can't be paid online. Please contact the association.";

function public_maintenance_load_pending_due(int $dueId): array
{
    $due = db_get('SELECT * FROM maintenance_payments WHERE id = ?', [$dueId]);
    if (!$due) {
        throw new ApiError(404, 'Due record not found');
    }
    if ($due['status'] === 'paid') {
        throw new ApiError(400, 'This due is already fully paid');
    }
    $member = db_get('SELECT status FROM members WHERE id = ?', [$due['member_id']]);
    if (($member['status'] ?? null) !== 'active') {
        throw new ApiError(403, PUBLIC_MAINTENANCE_INACTIVE_MESSAGE);
    }
    return $due;
}

// Loads and validates a set of due ids for a single combined payment - all must exist,
// belong to the same member, and still be outstanding.
function public_maintenance_load_pending_dues(array $ids): array
{
    if (!$ids) {
        throw new ApiError(400, 'No dues specified');
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $dues = db_all("SELECT * FROM maintenance_payments WHERE id IN ($placeholders)", $ids);
    if (count($dues) !== count($ids)) {
        throw new ApiError(404, 'One or more due records not found');
    }
    if (array_filter($dues, fn ($d) => $d['status'] === 'paid')) {
        throw new ApiError(400, 'One or more dues are already fully paid');
    }
    $memberId = $dues[0]['member_id'];
    if (array_filter($dues, fn ($d) => $d['member_id'] !== $memberId)) {
        throw new ApiError(400, 'Dues must belong to the same member');
    }
    $member = db_get('SELECT status FROM members WHERE id = ?', [$memberId]);
    if (($member['status'] ?? null) !== 'active') {
        throw new ApiError(403, PUBLIC_MAINTENANCE_INACTIVE_MESSAGE);
    }
    return $dues;
}

Router::get('/public/maintenance/razorpay-config', function () {
    $settings = razorpay_gateway_settings();
    Response::json([
        'configured' => !empty($settings['razorpay_key_id']) && !empty($settings['razorpay_key_secret']),
        'keyId' => $settings['razorpay_key_id'] ?: null,
    ]);
});

Router::get('/public/maintenance/qr', function ($params, $body, $query) {
    try {
        Response::json(build_upi_qr((float) ($query['amount'] ?? 0), $query['note'] ?? null));
    } catch (Throwable $e) {
        throw new ApiError(400, $e->getMessage());
    }
});

// Combined payment across several unpaid months for one member - one Razorpay order/payment
// sized to the sum of all remaining amounts, which then marks every included month paid.
// Registered before the /:id/* routes below since ':id' would otherwise greedily match "pay-multiple".
Router::post('/public/maintenance/pay-multiple/order', function ($params, $body) {
    if (!razorpay_is_configured()) {
        throw new ApiError(400, 'Online payments are not configured yet. Please use the UPI QR code instead.');
    }
    $ids = array_values(array_filter(array_map('intval', $body['dueIds'] ?? [])));
    $dues = public_maintenance_load_pending_dues($ids);

    $remaining = array_sum(array_map(fn ($d) => (float) $d['amount_due'] - (float) $d['amount_paid'], $dues));
    $amountPaise = (int) round($remaining * 100);
    try {
        $order = razorpay_create_order($amountPaise, 'dues_' . $dues[0]['member_id'] . '_' . time(), [
            'maintenance_payment_ids' => implode(',', array_map(fn ($d) => $d['id'], $dues)),
            'member_id' => (string) $dues[0]['member_id'],
        ]);
        $orderId = $order['id'];
        db_transaction(function () use ($dues, $orderId) {
            foreach ($dues as $d) {
                db_run('UPDATE maintenance_payments SET razorpay_order_id = ? WHERE id = ?', [$orderId, $d['id']]);
            }
        });
        $settings = razorpay_gateway_settings();
        Response::json([
            'orderId' => $order['id'],
            'amount' => $amountPaise,
            'currency' => $order['currency'],
            'keyId' => $settings['razorpay_key_id'],
            'payeeName' => $settings['payee_name'] ?: 'Sri Balamurugan Nagar Welfare Association',
        ]);
    } catch (Throwable $e) {
        error_log('Razorpay order creation failed (public maintenance, multi): ' . $e->getMessage());
        throw new ApiError(502, 'Could not reach Razorpay to create the order. Please try the UPI QR code instead.');
    }
});

Router::post('/public/maintenance/pay-multiple/verify', function ($params, $body) {
    $orderId = $body['razorpay_order_id'] ?? null;
    $paymentId = $body['razorpay_payment_id'] ?? null;
    $signature = $body['razorpay_signature'] ?? null;
    $dueIds = $body['dueIds'] ?? [];
    if (!$orderId || !$paymentId || !$signature) {
        throw new ApiError(400, 'Missing payment verification fields');
    }

    $settings = razorpay_gateway_settings();
    if (empty($settings['razorpay_key_secret'])) {
        throw new ApiError(400, 'Online payments are not configured');
    }

    $ids = array_values(array_filter(array_map('intval', is_array($dueIds) ? $dueIds : [])));
    $dues = public_maintenance_load_pending_dues($ids);

    foreach ($dues as $d) {
        if ($d['razorpay_order_id'] !== $orderId) {
            throw new ApiError(400, 'Order does not match these dues');
        }
    }
    if (!razorpay_verify_signature($orderId, $paymentId, $signature, $settings['razorpay_key_secret'])) {
        throw new ApiError(400, 'Payment signature verification failed');
    }

    db_transaction(function () use ($dues, $paymentId) {
        foreach ($dues as $d) {
            db_run(
                "UPDATE maintenance_payments
                 SET amount_paid = amount_due, status = 'paid', paid_date = CURDATE(), paid_at = NOW(), razorpay_payment_id = ?,
                     payment_mode = 'Razorpay', reference_no = ?
                 WHERE id = ?",
                [$paymentId, $paymentId, $d['id']]
            );
        }
    });

    $updatedDues = [];
    foreach ($dues as $d) {
        $updatedDues[] = db_get('SELECT * FROM maintenance_payments WHERE id = ?', [$d['id']]);
    }
    foreach ($updatedDues as $updated) {
        notify_admin_of_payment($updated);
    }
    notify_payment_whatsapp($updatedDues);
    $member = db_get('SELECT name, site_no FROM members WHERE id = ?', [$dues[0]['member_id']]);
    $total = array_sum(array_map(fn ($d) => (float) $d['amount_due'] - (float) $d['amount_paid'], $dues));
    $months = implode(', ', array_map(fn ($d) => "{$d['month']}/{$d['year']}", $dues));
    log_activity([
        'actor' => 'public',
        'action' => 'payment',
        'entityType' => 'maintenance_payment',
        'description' => ($member['name'] ?? 'Member') . ' (Site No ' . ($member['site_no'] ?? '-') . ") paid ₹$total online for " . count($dues) . " month(s): $months (due ids: " . implode(', ', array_map(fn ($d) => $d['id'], $dues)) . ')',
    ]);
    Response::json(['ok' => true]);
});

Router::post('/public/maintenance/:id/order', function ($params) {
    if (!razorpay_is_configured()) {
        throw new ApiError(400, 'Online payments are not configured yet. Please use the UPI QR code instead.');
    }
    $due = public_maintenance_load_pending_due((int) $params['id']);

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
        error_log('Razorpay order creation failed (public maintenance): ' . $e->getMessage());
        throw new ApiError(502, 'Could not reach Razorpay to create the order. Please try the UPI QR code instead.');
    }
});

Router::post('/public/maintenance/:id/verify', function ($params, $body) {
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

    $due = public_maintenance_load_pending_due((int) $params['id']);

    if ($due['razorpay_order_id'] !== $orderId) {
        throw new ApiError(400, 'Order does not match this due');
    }
    if (!razorpay_verify_signature($orderId, $paymentId, $signature, $settings['razorpay_key_secret'])) {
        throw new ApiError(400, 'Payment signature verification failed');
    }

    db_run(
        "UPDATE maintenance_payments
         SET amount_paid = amount_due, status = 'paid', paid_date = CURDATE(), paid_at = NOW(), razorpay_payment_id = ?,
             payment_mode = 'Razorpay', reference_no = ?
         WHERE id = ?",
        [$paymentId, $paymentId, $due['id']]
    );

    $updated = db_get('SELECT * FROM maintenance_payments WHERE id = ?', [$due['id']]);
    notify_admin_of_payment($updated);
    notify_payment_whatsapp([$updated]);
    $member = db_get('SELECT name, site_no FROM members WHERE id = ?', [$updated['member_id']]);
    log_activity([
        'actor' => 'public',
        'action' => 'payment',
        'entityType' => 'maintenance_payment',
        'entityId' => $updated['id'],
        'description' => ($member['name'] ?? 'Member') . ' (Site No ' . ($member['site_no'] ?? '-') . ") paid ₹{$updated['amount_paid']} online for {$updated['month']}/{$updated['year']}",
    ]);
    Response::json(['ok' => true]);
});
