<?php
// Hand-rolled HS256 JWT (no Composer dependency) - same claims shape and 12h expiry as the old
// Node app's jsonwebtoken usage, so existing tokens/clients need no changes.

const JWT_TTL_SECONDS = 12 * 60 * 60;

function jwt_secret(): string
{
    return env('JWT_SECRET', 'dev-secret-change-me');
}

function base64url_encode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64url_decode(string $data): string
{
    return base64_decode(strtr($data, '-_', '+/'));
}

function jwt_sign(array $claims): string
{
    $header = base64url_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $claims['iat'] = time();
    $claims['exp'] = time() + JWT_TTL_SECONDS;
    $payload = base64url_encode(json_encode($claims));
    $signature = base64url_encode(hash_hmac('sha256', "$header.$payload", jwt_secret(), true));
    return "$header.$payload.$signature";
}

function jwt_verify(string $token): array
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        throw new ApiError(401, 'Invalid or expired token');
    }
    [$header, $payload, $signature] = $parts;
    $expected = base64url_encode(hash_hmac('sha256', "$header.$payload", jwt_secret(), true));
    if (!hash_equals($expected, $signature)) {
        throw new ApiError(401, 'Invalid or expired token');
    }
    $claims = json_decode(base64url_decode($payload), true);
    if (!is_array($claims) || ($claims['exp'] ?? 0) < time()) {
        throw new ApiError(401, 'Invalid or expired token');
    }
    return $claims;
}

// Reads/verifies the Authorization header once per request and caches the decoded claims.
function current_user(): ?array
{
    static $user = false; // false = not yet resolved, null = resolved to "no user"
    if ($user !== false) {
        return $user;
    }
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!str_starts_with($header, 'Bearer ')) {
        return $user = null;
    }
    try {
        $user = jwt_verify(substr($header, 7));
    } catch (ApiError $e) {
        $user = null;
    }
    return $user;
}

function require_auth(): array
{
    $user = current_user();
    if (!$user) {
        throw new ApiError(401, 'Missing token');
    }
    return $user;
}

function require_admin(): array
{
    $user = require_auth();
    if (!in_array($user['role'] ?? '', ['admin', 'super_admin'], true)) {
        throw new ApiError(403, 'Admin access required');
    }
    return $user;
}

function require_super_admin(): array
{
    $user = require_auth();
    if (($user['role'] ?? '') !== 'super_admin') {
        throw new ApiError(403, 'Super Admin access required');
    }
    return $user;
}
