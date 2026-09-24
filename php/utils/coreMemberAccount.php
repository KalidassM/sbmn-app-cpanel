<?php
// Makes sure a Core Member has an 'admin'-role login account - used both right after a Core
// Member is added, and for bulk-catching up any Core Members added before this existed.
// - No login account yet: creates one (username = phone number, password = phone number +
//   "@core"), flagged to force a password change on first login.
// - Already has an account with a lower role ('member'): promotes it to 'admin' in place,
//   leaving their existing password untouched (they're already logging in with it).
// - Already 'admin'/'super_admin': nothing to do.
// Returns ['action' => 'created' | 'upgraded' | 'skipped', 'username' => ..., 'reason' => ...].
function ensure_core_member_account(int $memberId): array
{
    $member = db_get('SELECT id, name, phone, email FROM members WHERE id = ?', [$memberId]);
    if (!$member) {
        return ['action' => 'skipped', 'reason' => 'Member not found'];
    }

    $existing = db_get('SELECT id, role, username FROM users WHERE member_id = ?', [$memberId]);
    if ($existing) {
        if (in_array($existing['role'], ['admin', 'super_admin'], true)) {
            return ['action' => 'skipped', 'reason' => 'Already has an admin login account', 'username' => $existing['username']];
        }
        db_run('UPDATE users SET role = ? WHERE id = ?', ['admin', $existing['id']]);
        notify_member(
            $member,
            "Hi {$member['name']}, you've been made a Core Member of " . app_name() . ". Your existing account ({$existing['username']}) now has admin access. Visit the portal: " . portal_url() . "\n\n" . sign_off(),
            'You now have admin access on ' . app_name()
        );
        return ['action' => 'upgraded', 'username' => $existing['username']];
    }

    $username = first_phone_digits($member['phone']);
    if (!$username) {
        return ['action' => 'skipped', 'reason' => 'No usable phone number on file'];
    }

    $password = "$username@core";
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]);
    try {
        db_run(
            "INSERT INTO users (username, password_hash, role, member_id, must_change_password) VALUES (?, ?, 'admin', ?, 1)",
            [$username, $hash, $memberId]
        );
        notify_member(
            $member,
            "Hi {$member['name']}, you've been added as a Core Member of " . app_name() . " with admin portal access. Username: $username, Password: $password. Please log in at " . portal_url() . " and change your password.\n\n" . sign_off(),
            'Your Core Member admin account for ' . app_name()
        );
        return ['action' => 'created', 'username' => $username];
    } catch (Throwable $e) {
        return ['action' => 'skipped', 'reason' => 'Username already exists (duplicate phone number)'];
    }
}
