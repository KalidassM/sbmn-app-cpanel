<?php

const CORE_MEMBERS_SELECT_JOIN = '
  SELECT cm.*, m.name AS member_name, m.phone AS member_phone, m.email AS member_email
  FROM core_members cm
  JOIN members m ON m.id = cm.member_id
';

Router::get('/core-members', function () {
    require_auth();
    Response::json(db_all(CORE_MEMBERS_SELECT_JOIN . ' ORDER BY cm.end_date IS NOT NULL, cm.start_date DESC'));
});

Router::post('/core-members', function ($params, $body) {
    $user = require_admin();
    $memberId = $body['member_id'] ?? null;
    $designation = $body['designation'] ?? null;
    if (!$memberId || !$designation) {
        throw new ApiError(400, 'member_id and designation are required');
    }
    $member = db_get('SELECT * FROM members WHERE id = ?', [$memberId]);
    if (!$member) {
        throw new ApiError(400, 'Member does not exist');
    }
    $info = db_run(
        "INSERT INTO core_members (member_id, designation, start_date, end_date, notes, photo)
         VALUES (?, ?, COALESCE(?, CURDATE()), ?, ?, ?)",
        [$memberId, $designation, $body['start_date'] ?? null, $body['end_date'] ?? null, $body['notes'] ?? null, $body['photo'] ?? null]
    );
    $row = db_get(CORE_MEMBERS_SELECT_JOIN . ' WHERE cm.id = ?', [$info['insertId']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'create',
        'entityType' => 'core_member',
        'entityId' => $row['id'],
        'description' => "Added core member {$row['member_name']} as {$row['designation']}",
    ]);

    $account = ensure_core_member_account((int) $memberId);
    if (in_array($account['action'], ['created', 'upgraded'], true)) {
        log_activity([
            'actor' => $user['username'],
            'action' => 'update',
            'entityType' => 'user',
            'description' => $account['action'] === 'created'
                ? "Created admin login account {$account['username']} for core member {$row['member_name']}"
                : "Upgraded login account {$account['username']} to admin for core member {$row['member_name']}",
        ]);
    }

    Response::json(array_merge($row, ['account' => $account]), 201);
});

Router::put('/core-members/:id', function ($params, $body) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM core_members WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Core member record not found');
    }
    db_run(
        'UPDATE core_members SET designation = ?, start_date = ?, end_date = ?, notes = ?, photo = ? WHERE id = ?',
        [
            $body['designation'] ?? $existing['designation'],
            $body['start_date'] ?? $existing['start_date'],
            array_key_exists('end_date', $body) ? $body['end_date'] : $existing['end_date'],
            $body['notes'] ?? $existing['notes'],
            array_key_exists('photo', $body) ? $body['photo'] : $existing['photo'],
            $params['id'],
        ]
    );
    $row = db_get(CORE_MEMBERS_SELECT_JOIN . ' WHERE cm.id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'core_member',
        'entityId' => $row['id'],
        'description' => "Updated core member {$row['member_name']} ({$row['designation']})",
    ]);
    Response::json($row);
});

Router::delete('/core-members/:id', function ($params) {
    $user = require_admin();
    $existing = db_get(CORE_MEMBERS_SELECT_JOIN . ' WHERE cm.id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Core member record not found');
    }
    db_run('DELETE FROM core_members WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'delete',
        'entityType' => 'core_member',
        'entityId' => $existing['id'],
        'description' => "Removed core member {$existing['member_name']} ({$existing['designation']})",
    ]);
    Response::json(['ok' => true]);
});
