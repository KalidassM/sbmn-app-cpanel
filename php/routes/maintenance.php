<?php

Router::get('/maintenance/payments', function ($params, $body, $query) {
    require_auth();
    $month = $query['month'] ?? null;
    $year = $query['year'] ?? null;
    if ($month && $year) {
        ensure_dues_generated((int) $month, (int) $year);
    }

    $sql = 'SELECT mp.*, m.name AS member_name, m.site_no, m.phone FROM maintenance_payments mp
             JOIN members m ON m.id = mp.member_id';
    // A currently-active member shows for every due. An inactive member only shows for dues from
    // before the month they went inactive in (e.g. active through July, inactive from August 5th ->
    // still shows on the July due, hidden from August onward) - a member with no inactive_date on
    // record has no way to know which months they were active for, so stays hidden everywhere.
    // Symmetrically, a member never shows for a due from before the month they joined in.
    $clauses = [
        "(m.status = 'active' OR (m.inactive_date IS NOT NULL AND (mp.year * 100 + mp.month) < (YEAR(m.inactive_date) * 100 + MONTH(m.inactive_date))))",
        '(mp.year * 100 + mp.month) >= (YEAR(m.join_date) * 100 + MONTH(m.join_date))',
    ];
    $sqlParams = [];
    if ($month) {
        $clauses[] = 'mp.month = ?';
        $sqlParams[] = (int) $month;
    }
    if ($year) {
        $clauses[] = 'mp.year = ?';
        $sqlParams[] = (int) $year;
    }
    if (!empty($query['member_id'])) {
        $clauses[] = 'mp.member_id = ?';
        $sqlParams[] = (int) $query['member_id'];
    }
    $sql .= ' WHERE ' . implode(' AND ', $clauses);
    $sql .= ' ORDER BY mp.year DESC, mp.month DESC, m.name';
    Response::json(db_all($sql, $sqlParams));
});

// Marks a batch of dues fully paid in one action (e.g. cash collected from several members at
// once) - skips any row already paid rather than erroring on it.
Router::post('/maintenance/payments/bulk-mark-paid', function ($params, $body) {
    $user = require_admin();
    $ids = $body['ids'] ?? null;
    if (!is_array($ids) || !$ids) {
        throw new ApiError(400, 'ids array is required');
    }

    $today = (new DateTime())->format('Y-m-d');
    $now = (new DateTime())->format('Y-m-d H:i:s');
    $updated = 0;
    db_transaction(function () use ($ids, $today, $now, &$updated) {
        foreach ($ids as $id) {
            $result = db_run(
                "UPDATE maintenance_payments SET amount_paid = amount_due, status = 'paid', paid_date = ?, paid_at = ? WHERE id = ? AND status != 'paid'",
                [$today, $now, $id]
            );
            $updated += $result['changes'];
        }
    });
    log_activity([
        'actor' => $user['username'],
        'action' => 'payment',
        'entityType' => 'maintenance_payment',
        'description' => "Bulk marked $updated of " . count($ids) . ' selected due(s) as paid (ids: ' . implode(', ', $ids) . ')',
    ]);
    Response::json(['updated' => $updated]);
});

// Admin-only view of who still owes for a month and whether the automated WhatsApp reminder
// reached them - pre-filtered server-side (unlike /payments) since it's built to surface phone
// numbers + delivery errors in bulk, which only the admin should see.
Router::get('/maintenance/reminders', function ($params, $body, $query) {
    require_admin();
    $month = (int) ($query['month'] ?? (new DateTime())->format('n'));
    $year = (int) ($query['year'] ?? (new DateTime())->format('Y'));
    ensure_dues_generated($month, $year);

    $rows = db_all(
        "SELECT mp.id, mp.amount_due, mp.amount_paid, mp.status, mp.last_reminder_sent_at, mp.last_reminder_error,
                m.name AS member_name, m.site_no, m.phone, m.email
         FROM maintenance_payments mp
         JOIN members m ON m.id = mp.member_id
         WHERE mp.month = ? AND mp.year = ? AND mp.status != 'paid' AND m.status = 'active'
         ORDER BY CAST(m.site_no AS SIGNED), m.site_no",
        [$month, $year]
    );
    Response::json($rows);
});

// Sends (right now, bypassing every schedule guard) just this one member's reminder - for
// nudging a single straggler without resending to everyone else who's already been reminded.
Router::post('/maintenance/reminders/:id/send', function ($params) {
    require_admin();
    Response::json(send_single_reminder((int) $params['id']));
});

// Manually re-runs today's reminder send, bypassing the day/time/already-sent guards - for
// testing a schedule change or re-notifying stragglers without waiting for tomorrow.
Router::post('/maintenance/reminders/resend-today', function () {
    require_admin();
    try {
        Response::json(send_daily_reminders(true));
    } catch (Throwable $e) {
        throw new ApiError(500, $e->getMessage());
    }
});

Router::put('/maintenance/payments/:id', function ($params, $body) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM maintenance_payments WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Payment record not found');
    }
    $finalAmountDue = $body['amount_due'] ?? $existing['amount_due'];
    $finalAmountPaid = $body['amount_paid'] ?? $existing['amount_paid'];
    $finalStatus = $body['status'] ?? null;
    if (!$finalStatus) {
        if ($finalAmountPaid <= 0) {
            $finalStatus = 'unpaid';
        } elseif ($finalAmountPaid >= $finalAmountDue) {
            $finalStatus = 'paid';
        } else {
            $finalStatus = 'partial';
        }
    }
    $becomingPaid = $finalStatus === 'paid' && $existing['status'] !== 'paid';
    db_run(
        'UPDATE maintenance_payments SET amount_due = ?, amount_paid = ?, paid_date = ?, paid_at = ?, status = ?, payment_mode = ?, reference_no = ? WHERE id = ?',
        [
            $finalAmountDue,
            $finalAmountPaid,
            $body['paid_date'] ?? ($finalStatus === 'paid' ? (new DateTime())->format('Y-m-d') : $existing['paid_date']),
            $becomingPaid ? (new DateTime())->format('Y-m-d H:i:s') : $existing['paid_at'],
            $finalStatus,
            array_key_exists('payment_mode', $body) ? ($body['payment_mode'] ?: null) : $existing['payment_mode'],
            array_key_exists('reference_no', $body) ? ($body['reference_no'] ?: null) : $existing['reference_no'],
            $params['id'],
        ]
    );
    $row = db_get('SELECT * FROM maintenance_payments WHERE id = ?', [$params['id']]);
    if ($finalAmountPaid > $existing['amount_paid']) {
        notify_admin_of_payment($row);
        notify_payment_whatsapp([$row]);
    }
    $member = db_get('SELECT name, site_no FROM members WHERE id = ?', [$row['member_id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => $finalAmountPaid > $existing['amount_paid'] ? 'payment' : 'update',
        'entityType' => 'maintenance_payment',
        'entityId' => $row['id'],
        'description' => ($member['name'] ?? 'Member') . ' (Site No ' . ($member['site_no'] ?? '-') . ") - {$row['month']}/{$row['year']} maintenance set to $finalStatus, paid ₹$finalAmountPaid of ₹$finalAmountDue",
    ]);
    Response::json($row);
});

Router::delete('/maintenance/payments/:id', function ($params) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM maintenance_payments WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Payment record not found');
    }
    db_run('DELETE FROM maintenance_payments WHERE id = ?', [$params['id']]);
    $member = db_get('SELECT name, site_no FROM members WHERE id = ?', [$existing['member_id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'delete',
        'entityType' => 'maintenance_payment',
        'entityId' => $existing['id'],
        'description' => 'Deleted ' . ($member['name'] ?? 'member') . ' (Site No ' . ($member['site_no'] ?? '-') . ")'s maintenance due for {$existing['month']}/{$existing['year']}",
    ]);
    Response::json(['ok' => true]);
});
