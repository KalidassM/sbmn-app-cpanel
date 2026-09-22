<?php

const RESET_CODE_TTL_MINUTES = 15;

function auth_public_user(array $user, ?bool $mustChangePassword = null): array
{
    return [
        'id' => $user['id'],
        'username' => $user['username'],
        'role' => $user['role'],
        'member_id' => $user['member_id'],
        'must_change_password' => $mustChangePassword ?? (bool) $user['must_change_password'],
    ];
}

function auth_issue_token(array $user, ?bool $mustChangePassword = null): string
{
    $claims = auth_public_user($user, $mustChangePassword);
    $claims['must_change_password'] = (bool) $claims['must_change_password'];
    return jwt_sign($claims);
}

Router::post('/auth/login', function ($params, $body) {
    $username = $body['username'] ?? null;
    $password = $body['password'] ?? null;
    if (!$username || !$password) {
        throw new ApiError(400, 'Username and password required');
    }
    $user = db_get('SELECT * FROM users WHERE username = ?', [$username]);
    if (!$user || !password_verify($password, $user['password_hash'])) {
        throw new ApiError(401, 'Invalid credentials');
    }
    db_run('UPDATE users SET last_login_at = NOW() WHERE id = ?', [$user['id']]);
    Response::json([
        'token' => auth_issue_token($user),
        'user' => auth_public_user($user),
    ]);
});

Router::get('/auth/me', function () {
    Response::json(['user' => require_auth()]);
});

Router::post('/auth/change-password', function ($params, $body) {
    $currentUser = require_auth();
    $currentPassword = $body['currentPassword'] ?? null;
    $newPassword = $body['newPassword'] ?? null;
    if (!$currentPassword || !$newPassword) {
        throw new ApiError(400, 'Current and new password required');
    }
    $user = db_get('SELECT * FROM users WHERE id = ?', [$currentUser['id']]);
    if (!$user || !password_verify($currentPassword, $user['password_hash'])) {
        throw new ApiError(401, 'Current password is incorrect');
    }
    $hash = password_hash($newPassword, PASSWORD_BCRYPT, ['cost' => 10]);
    db_run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [$hash, $user['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'user',
        'entityId' => $user['id'],
        'description' => "{$user['username']} changed their own password",
    ]);

    // Issue a fresh token/user so the client can clear the forced-change-password state without
    // having to log in again - the old token's must_change_password claim would otherwise stick
    // around until it naturally expires.
    Response::json([
        'ok' => true,
        'token' => auth_issue_token($user, false),
        'user' => auth_public_user($user, false),
    ]);
});

// A user's WhatsApp number for the reset code: their linked member's phone, or - for accounts
// created without a member link (e.g. the default admin) - the username itself if it looks like
// a phone number, matching the "username = phone number" convention used for bulk-created accounts.
function auth_resolve_reset_phone(array $user): ?string
{
    if (!empty($user['member_id'])) {
        $member = db_get('SELECT phone FROM members WHERE id = ?', [$user['member_id']]);
        if (!empty($member['phone'])) {
            return $member['phone'];
        }
    }
    return preg_match('/^\d{10}$/', $user['username']) ? $user['username'] : null;
}

Router::post('/auth/forgot-password', function ($params, $body) {
    $username = $body['username'] ?? null;
    if (!$username) {
        throw new ApiError(400, 'Username is required');
    }

    $user = db_get('SELECT * FROM users WHERE username = ?', [$username]);
    if (!$user) {
        throw new ApiError(404, 'No account found with that username');
    }

    $phone = auth_resolve_reset_phone($user);
    if (!$phone) {
        throw new ApiError(400, 'No phone number on file for this account. Contact an administrator.');
    }

    if (!wa_is_connected()) {
        throw new ApiError(503, 'WhatsApp is not configured right now. Please contact an administrator.');
    }

    $code = (string) random_int(100000, 999999);
    $codeHash = password_hash($code, PASSWORD_BCRYPT, ['cost' => 10]);
    $expiresAt = (new DateTime('+' . RESET_CODE_TTL_MINUTES . ' minutes'))->format('Y-m-d H:i:s');
    db_run('UPDATE users SET reset_code_hash = ?, reset_code_expires_at = ? WHERE id = ?', [$codeHash, $expiresAt, $user['id']]);

    $settings = db_get('SELECT app_name FROM general_settings WHERE id = 1');
    $appName = $settings['app_name'] ?? 'the Association';
    $text = "Your password reset code for $appName portal is: $code. It expires in " . RESET_CODE_TTL_MINUTES . " minutes. If you did not request this, please ignore this message.\n\n" . sign_off();

    try {
        wa_send_message($phone, $text);
        Response::json(['ok' => true]);
    } catch (Throwable $e) {
        error_log('Forgot-password WhatsApp send failed: ' . $e->getMessage());
        throw new ApiError(500, 'Could not send the reset code over WhatsApp. Please try again or contact an administrator.');
    }
});

Router::post('/auth/reset-password', function ($params, $body) {
    $username = $body['username'] ?? null;
    $code = $body['code'] ?? null;
    $newPassword = $body['newPassword'] ?? null;
    if (!$username || !$code || !$newPassword) {
        throw new ApiError(400, 'Username, code and new password are required');
    }
    $user = db_get('SELECT * FROM users WHERE username = ?', [$username]);
    if (!$user || !$user['reset_code_hash']) {
        throw new ApiError(400, 'Invalid or expired code');
    }
    if (!$user['reset_code_expires_at'] || strtotime($user['reset_code_expires_at']) < time()) {
        throw new ApiError(400, 'This code has expired. Please request a new one.');
    }
    if (!password_verify((string) $code, $user['reset_code_hash'])) {
        throw new ApiError(400, 'Invalid or expired code');
    }

    $hash = password_hash($newPassword, PASSWORD_BCRYPT, ['cost' => 10]);
    db_run(
        'UPDATE users SET password_hash = ?, must_change_password = 0, reset_code_hash = NULL, reset_code_expires_at = NULL WHERE id = ?',
        [$hash, $user['id']]
    );
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'user',
        'entityId' => $user['id'],
        'description' => "{$user['username']} reset their password via forgot-password",
    ]);

    Response::json([
        'ok' => true,
        'token' => auth_issue_token($user, false),
        'user' => auth_public_user($user, false),
    ]);
});
