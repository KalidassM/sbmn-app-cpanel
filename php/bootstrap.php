<?php
// Wires the whole app together - required once by public/api/index.php (for HTTP requests) and
// by scripts/send-reminders.php (for the cron job), matching what server/index.js did for the old
// Node app.

declare(strict_types=1);

require_once __DIR__ . '/env.php';
require_once __DIR__ . '/response.php';
require_once __DIR__ . '/errors.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/router.php';

foreach (glob(__DIR__ . '/utils/*.php') as $file) {
    require_once $file;
}

// Route files register themselves with Router::get/post/put/delete at include time - safe to
// load in any order since each resource's URL prefix is disjoint from every other's; the
// *internal* ordering within a single route file (e.g. "/members/me" before "/members/:id")
// is what actually matters, and that's preserved inside each file.
foreach (glob(__DIR__ . '/routes/*.php') as $file) {
    require_once $file;
}
