<?php

// Phone numbers are only for admin/super_admin eyes - a plain member can see the directory but
// not everyone's contact number.
function members_redact_phone(array $member, array $user): array
{
    if (in_array($user['role'], ['admin', 'super_admin'], true)) {
        return $member;
    }
    unset($member['phone']);
    return $member;
}

Router::get('/members', function () {
    $user = require_auth();
    $members = db_all('SELECT * FROM members ORDER BY CAST(site_no AS SIGNED), site_no');
    Response::json(array_map(fn ($m) => members_redact_phone($m, $user), $members));
});

// Self-service profile - must be registered before GET/PUT /:id, otherwise "me" would be captured
// as an :id value (same route-ordering pitfall as bulk-status below).
Router::get('/members/me', function () {
    $user = require_auth();
    if (!$user['member_id']) {
        Response::json(null);
    }
    Response::json(db_get('SELECT * FROM members WHERE id = ?', [$user['member_id']]));
});

// Lets a logged-in user update their own contact details. Deliberately narrower than the
// admin-only PUT /:id: no site_no, join_date, status, or inactive_date - those stay
// admin-managed regardless of what the request body contains.
Router::put('/members/me', function ($params, $body) {
    $user = require_auth();
    if (!$user['member_id']) {
        throw new ApiError(400, 'No member profile is linked to this account');
    }
    $existing = db_get('SELECT * FROM members WHERE id = ?', [$user['member_id']]);
    if (!$existing) {
        throw new ApiError(404, 'Member not found');
    }
    db_run('UPDATE members SET phone = ?, email = ?, address = ? WHERE id = ?', [
        $body['phone'] ?? $existing['phone'],
        $body['email'] ?? $existing['email'],
        $body['address'] ?? $existing['address'],
        $existing['id'],
    ]);
    $member = db_get('SELECT * FROM members WHERE id = ?', [$existing['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'member',
        'entityId' => $member['id'],
        'description' => "{$member['name']} updated their own profile",
    ]);
    Response::json($member);
});

Router::get('/members/:id', function ($params) {
    $user = require_auth();
    $member = db_get('SELECT * FROM members WHERE id = ?', [$params['id']]);
    if (!$member) {
        throw new ApiError(404, 'Member not found');
    }
    Response::json(members_redact_phone($member, $user));
});

Router::post('/members', function ($params, $body) {
    $user = require_admin();
    $name = $body['name'] ?? null;
    if (!$name) {
        throw new ApiError(400, 'Name is required');
    }
    $info = db_run(
        "INSERT INTO members (name, site_no, address, phone, email, join_date, status)
         VALUES (?, ?, ?, ?, ?, COALESCE(?, CURDATE()), COALESCE(?, 'active'))",
        [$name, $body['site_no'] ?? null, $body['address'] ?? null, $body['phone'] ?? null, $body['email'] ?? null, $body['join_date'] ?? null, $body['status'] ?? null]
    );
    $member = db_get('SELECT * FROM members WHERE id = ?', [$info['insertId']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'create',
        'entityType' => 'member',
        'entityId' => $member['id'],
        'description' => "Added member {$member['name']} (Site No " . ($member['site_no'] ?: '-') . ')',
    ]);
    notify_member($member, welcome_message($member), 'Welcome to ' . app_name());
    Response::json($member, 201);
});

// Upsert by site_no: rows whose site_no matches an existing member update that member, others are inserted
Router::post('/members/bulk', function ($params, $body) {
    $user = require_admin();
    $rows = $body['members'] ?? null;
    if (!is_array($rows) || !$rows) {
        throw new ApiError(400, 'members array is required');
    }

    $inserted = 0;
    $updated = 0;
    $skipped = [];

    db_transaction(function () use ($rows, &$inserted, &$updated, &$skipped) {
        foreach ($rows as $idx => $row) {
            $name = trim((string) ($row['name'] ?? ''));
            $siteNo = trim((string) ($row['site_no'] ?? '')) ?: null;
            if (!$name) {
                $skipped[] = ['row' => $idx + 2, 'reason' => 'Missing name'];
                continue;
            }
            $existing = $siteNo ? db_get('SELECT id FROM members WHERE site_no = ?', [$siteNo]) : null;
            if ($existing) {
                db_run(
                    'UPDATE members SET name = ?, address = COALESCE(?, address), phone = COALESCE(?, phone), email = COALESCE(?, email),
                       join_date = COALESCE(?, join_date), status = COALESCE(?, status)
                     WHERE id = ?',
                    [$name, $row['address'] ?? null, $row['phone'] ?? null, $row['email'] ?? null, $row['join_date'] ?? null, $row['status'] ?? null, $existing['id']]
                );
                $updated++;
            } else {
                db_run(
                    "INSERT INTO members (name, site_no, address, phone, email, join_date, status)
                     VALUES (?, ?, ?, ?, ?, COALESCE(?, CURDATE()), COALESCE(?, 'active'))",
                    [$name, $siteNo, $row['address'] ?? null, $row['phone'] ?? null, $row['email'] ?? null, $row['join_date'] ?? null, $row['status'] ?? null]
                );
                $inserted++;
            }
        }
    });

    log_activity([
        'actor' => $user['username'],
        'action' => 'bulk_upload',
        'entityType' => 'member',
        'description' => "Bulk upload: $inserted added, $updated updated, " . count($skipped) . ' skipped',
    ]);
    Response::json(['inserted' => $inserted, 'updated' => $updated, 'skipped' => $skipped]);
});

// Must be registered before PUT /:id, otherwise "bulk-status" would be captured as an :id value.
Router::put('/members/bulk-status', function ($params, $body) {
    $user = require_admin();
    $ids = $body['ids'] ?? null;
    $status = $body['status'] ?? null;
    if (!is_array($ids) || !$ids) {
        throw new ApiError(400, 'ids array is required');
    }
    if (!in_array($status, ['active', 'inactive'], true)) {
        throw new ApiError(400, 'status must be active or inactive');
    }

    $today = (new DateTime())->format('Y-m-d');
    $updated = 0;
    $changedMembers = [];
    db_transaction(function () use ($ids, $status, $today, &$updated, &$changedMembers) {
        foreach ($ids as $id) {
            $existing = db_get('SELECT * FROM members WHERE id = ?', [$id]);
            if (!$existing) {
                continue;
            }
            $result = db_run('UPDATE members SET status = ?, inactive_date = ? WHERE id = ?', [$status, $status === 'inactive' ? $today : null, $id]);
            $updated += $result['changes'];
            if ($result['changes'] && $existing['status'] !== $status) {
                $changedMembers[] = $existing;
            }
        }
    });

    log_activity([
        'actor' => $user['username'],
        'action' => 'status_change',
        'entityType' => 'member',
        'description' => 'Bulk status change: ' . count($changedMembers) . " member(s) set to $status (" . (implode(', ', array_map(fn ($m) => $m['name'], $changedMembers)) ?: 'none') . ')',
    ]);
    Response::json(['updated' => $updated]);
});

Router::put('/members/:id', function ($params, $body) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM members WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Member not found');
    }
    $finalStatus = $body['status'] ?? $existing['status'];
    $inactiveDate = $existing['inactive_date'];
    if ($finalStatus === 'inactive') {
        if (!empty($body['inactive_date'])) {
            $inactiveDate = $body['inactive_date'];
        } elseif ($existing['status'] !== 'inactive') {
            $inactiveDate = (new DateTime())->format('Y-m-d');
        }
    } elseif ($finalStatus === 'active') {
        $inactiveDate = null;
    }
    db_run(
        'UPDATE members SET name = ?, site_no = ?, address = ?, phone = ?, email = ?, join_date = ?, status = ?, inactive_date = ?
         WHERE id = ?',
        [
            $body['name'] ?? $existing['name'],
            $body['site_no'] ?? $existing['site_no'],
            $body['address'] ?? $existing['address'],
            $body['phone'] ?? $existing['phone'],
            $body['email'] ?? $existing['email'],
            $body['join_date'] ?? $existing['join_date'],
            $finalStatus,
            $inactiveDate,
            $params['id'],
        ]
    );
    $member = db_get('SELECT * FROM members WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => $finalStatus !== $existing['status'] ? 'status_change' : 'update',
        'entityType' => 'member',
        'entityId' => $member['id'],
        'description' => $finalStatus !== $existing['status']
            ? "Set {$member['name']} (Site No " . ($member['site_no'] ?: '-') . ") to $finalStatus"
            : "Updated member {$member['name']} (Site No " . ($member['site_no'] ?: '-') . ')',
    ]);
    Response::json($member);
});

Router::delete('/members/:id', function ($params) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM members WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Member not found');
    }
    db_run('DELETE FROM members WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'delete',
        'entityType' => 'member',
        'entityId' => $existing['id'],
        'description' => "Deleted member {$existing['name']} (Site No " . ($existing['site_no'] ?: '-') . ')',
    ]);
    Response::json(['ok' => true]);
});
