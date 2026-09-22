<?php
// Front controller for every /api/* request - reached via the rewrite rule in public/.htaccess.
declare(strict_types=1);

require_once __DIR__ . '/../../php/bootstrap.php';

// Permissive CORS, matching the old Node app's `app.use(cors())`.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';
$path = preg_replace('#^/api#', '', $path);
if ($path === '') {
    $path = '/';
}
$path = rtrim($path, '/');
if ($path === '') {
    $path = '/';
}

Router::dispatch($_SERVER['REQUEST_METHOD'], $path);
