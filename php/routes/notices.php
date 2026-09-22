<?php

Router::get('/notices', function () {
    require_auth();
    Response::json(db_all('SELECT * FROM notices ORDER BY pinned DESC, created_at DESC'));
});

Router::post('/notices', function ($params, $body) {
    $user = require_admin();
    $title = $body['title'] ?? null;
    $bodyText = $body['body'] ?? null;
    if (!$title || !$bodyText) {
        throw new ApiError(400, 'title and body are required');
    }
    $info = db_run(
        'INSERT INTO notices (title, body, pinned) VALUES (?, ?, ?)',
        [mb_substr(trim($title), 0, 80), mb_substr(trim($bodyText), 0, 400), !empty($body['pinned']) ? 1 : 0]
    );
    $row = db_get('SELECT * FROM notices WHERE id = ?', [$info['insertId']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'create',
        'entityType' => 'notice',
        'entityId' => $row['id'],
        'description' => "Added notice {$row['title']}",
    ]);
    Response::json($row, 201);
});

Router::put('/notices/:id', function ($params, $body) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM notices WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Notice not found');
    }
    db_run('UPDATE notices SET title = ?, body = ?, pinned = ? WHERE id = ?', [
        array_key_exists('title', $body) ? mb_substr(trim($body['title']), 0, 80) : $existing['title'],
        array_key_exists('body', $body) ? mb_substr(trim($body['body']), 0, 400) : $existing['body'],
        array_key_exists('pinned', $body) ? ($body['pinned'] ? 1 : 0) : $existing['pinned'],
        $params['id'],
    ]);
    $row = db_get('SELECT * FROM notices WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'notice',
        'entityId' => $row['id'],
        'description' => "Updated notice {$row['title']}",
    ]);
    Response::json($row);
});

Router::delete('/notices/:id', function ($params) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM notices WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Notice not found');
    }
    db_run('DELETE FROM notices WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'delete',
        'entityType' => 'notice',
        'entityId' => $existing['id'],
        'description' => "Deleted notice {$existing['title']}",
    ]);
    Response::json(['ok' => true]);
});
