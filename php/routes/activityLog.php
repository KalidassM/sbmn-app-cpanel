<?php

Router::get('/activity-log', function ($params, $body, $query) {
    require_admin();
    $limit = min((int) ($query['limit'] ?? 200) ?: 200, 500);
    Response::json(db_all('SELECT * FROM activity_log ORDER BY id DESC LIMIT ' . (int) $limit));
});
