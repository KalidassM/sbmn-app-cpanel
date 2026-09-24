<?php

// A newly-created account's WhatsApp number: the linked member's phone, or - for accounts not
// linked to a member - the username itself if it looks like a phone number, matching the
// "username = phone number" convention used everywhere else in this app.
function users_resolve_account_phone(string $username, ?array $member): ?string
{
    if (!empty($member['phone'])) {
        return $member['phone'];
    }
    return preg_match('/^\d{10}$/', $username) ? $username : null;
}

Router::get('/users', function () {
    require_admin();
    Response::json(db_all(
        'SELECT u.id, u.username, u.role, u.member_id, m.name AS member_name, u.created_at, u.must_change_password, u.last_login_at
         FROM users u LEFT JOIN members m ON m.id = u.member_id ORDER BY u.username'
    ));
});

Router::post('/users', function ($params, $body) {
    $currentUser = require_admin();
    $username = $body['username'] ?? null;
    $password = $body['password'] ?? null;
    $role = $body['role'] ?? null;
    if (!$username || !$password) {
        throw new ApiError(400, 'username and password are required');
    }
    if ($role === 'super_admin' && $currentUser['role'] !== 'super_admin') {
        throw new ApiError(403, 'Only a Super Admin can create another Super Admin account');
    }
    $finalRole = in_array($role, ['admin', 'super_admin'], true) ? $role : 'member';
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]);
    try {
        $info = db_run(
            'INSERT INTO users (username, password_hash, role, member_id, must_change_password) VALUES (?, ?, ?, ?, 1)',
            [$username, $hash, $finalRole, $body['member_id'] ?? null]
        );
        $row = db_get('SELECT id, username, role, member_id FROM users WHERE id = ?', [$info['insertId']]);
        log_activity([
            'actor' => $currentUser['username'],
            'action' => 'create',
            'entityType' => 'user',
            'entityId' => $row['id'],
            'description' => "Created user {$row['username']} (role: {$row['role']})",
        ]);

        $member = $row['member_id'] ? db_get('SELECT name, phone, email FROM members WHERE id = ?', [$row['member_id']]) : null;
        $phone = users_resolve_account_phone($row['username'], $member);
        if ($phone || !empty($member['email'])) {
            $name = $member['name'] ?? $row['username'];
            notify_member(
                ['phone' => $phone, 'email' => $member['email'] ?? null],
                "Hi $name, your login account for " . app_name() . " has been created. Username: {$row['username']}, Password: $password. Please log in at " . portal_url() . ' and change your password.' . "\n\n" . sign_off(),
                'Your login account for ' . app_name()
            );
        }

        Response::json($row, 201);
    } catch (Throwable $e) {
        throw new ApiError(400, 'Username already exists');
    }
});

// Creates a login account (role 'member') for every active member who doesn't already have one,
// using their phone number as both the username and the initial password (with "@123" appended).
// Flags the account so the forced-change-password flow kicks in on first login. Safe to re-run -
// members who already have a linked login are skipped, not duplicated.
Router::post('/users/bulk-create-for-members', function () {
    $user = require_super_admin();
    $members = db_all("SELECT id, name, phone FROM members WHERE status = 'active'");

    $created = 0;
    $createdAccounts = [];
    $skipped = [];

    db_transaction(function () use ($members, &$created, &$createdAccounts, &$skipped) {
        foreach ($members as $m) {
            if (db_get('SELECT id FROM users WHERE member_id = ?', [$m['id']])) {
                $skipped[] = ['member_id' => $m['id'], 'name' => $m['name'], 'reason' => 'Already has a login account'];
                continue;
            }
            $username = first_phone_digits($m['phone']);
            if (!$username) {
                $skipped[] = ['member_id' => $m['id'], 'name' => $m['name'], 'reason' => 'No usable phone number on file'];
                continue;
            }
            $password = "$username@123";
            $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]);
            try {
                db_run(
                    "INSERT INTO users (username, password_hash, role, member_id, must_change_password) VALUES (?, ?, 'member', ?, 1)",
                    [$username, $hash, $m['id']]
                );
                $created++;
                $createdAccounts[] = ['member_id' => $m['id'], 'name' => $m['name'], 'username' => $username];
            } catch (Throwable $e) {
                $skipped[] = ['member_id' => $m['id'], 'name' => $m['name'], 'reason' => 'Username already exists (duplicate phone number)'];
            }
        }
    });

    log_activity([
        'actor' => $user['username'],
        'action' => 'bulk_upload',
        'entityType' => 'user',
        'description' => "Bulk-created $created member login account(s); " . count($skipped) . ' skipped',
    ]);
    Response::json(['created' => $created, 'createdAccounts' => $createdAccounts, 'skipped' => $skipped]);
});

// Catches up any Core Member assigned before the auto-account flow existed (or whose account
// creation was skipped at the time) - creates/upgrades an 'admin'-role login for every currently
// active core member (end_date not set), via the same ensure_core_member_account used on assignment.
Router::post('/users/bulk-create-for-core-members', function () {
    $user = require_super_admin();
    $coreMembers = db_all(
        'SELECT cm.member_id, m.name FROM core_members cm JOIN members m ON m.id = cm.member_id WHERE cm.end_date IS NULL'
    );

    $created = 0;
    $upgraded = 0;
    $createdAccounts = [];
    $skipped = [];

    foreach ($coreMembers as $cm) {
        $result = ensure_core_member_account((int) $cm['member_id']);
        if ($result['action'] === 'created') {
            $created++;
            $createdAccounts[] = ['member_id' => $cm['member_id'], 'name' => $cm['name'], 'username' => $result['username']];
        } elseif ($result['action'] === 'upgraded') {
            $upgraded++;
            $createdAccounts[] = ['member_id' => $cm['member_id'], 'name' => $cm['name'], 'username' => $result['username']];
        } else {
            $skipped[] = ['member_id' => $cm['member_id'], 'name' => $cm['name'], 'reason' => $result['reason']];
        }
    }

    log_activity([
        'actor' => $user['username'],
        'action' => 'bulk_upload',
        'entityType' => 'user',
        'description' => "Bulk-created $created and upgraded $upgraded core member admin login account(s); " . count($skipped) . ' skipped',
    ]);
    Response::json(['created' => $created, 'upgraded' => $upgraded, 'createdAccounts' => $createdAccounts, 'skipped' => $skipped]);
});

Router::put('/users/:id/reset-password', function ($params, $body) {
    $user = require_super_admin();
    $password = $body['password'] ?? null;
    if (!$password) {
        throw new ApiError(400, 'password is required');
    }
    $existing = db_get('SELECT * FROM users WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'User not found');
    }
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]);
    db_run('UPDATE users SET password_hash = ? WHERE id = ?', [$hash, $params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'user',
        'entityId' => $existing['id'],
        'description' => "Reset password for user {$existing['username']}",
    ]);
    Response::json(['ok' => true]);
});

Router::delete('/users/:id', function ($params) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM users WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'User not found');
    }
    if ($existing['username'] === 'admin') {
        throw new ApiError(400, 'Cannot delete the default admin account');
    }
    db_run('DELETE FROM users WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'delete',
        'entityType' => 'user',
        'entityId' => $existing['id'],
        'description' => "Deleted user {$existing['username']} (role: {$existing['role']})",
    ]);
    Response::json(['ok' => true]);
});
