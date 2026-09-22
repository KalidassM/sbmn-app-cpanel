<?php

Router::get('/events', function () {
    require_auth();
    Response::json(db_all('SELECT * FROM events ORDER BY event_date DESC'));
});

Router::get('/events/:id', function ($params) {
    require_auth();
    $event = db_get('SELECT * FROM events WHERE id = ?', [$params['id']]);
    if (!$event) {
        throw new ApiError(404, 'Event not found');
    }
    $expenses = db_all('SELECT * FROM expenses WHERE event_id = ? ORDER BY expense_date', [$params['id']]);
    $donations = db_all('SELECT * FROM donations WHERE event_id = ? ORDER BY donation_date', [$params['id']]);
    Response::json(array_merge($event, ['expenses' => $expenses, 'donations' => $donations]));
});

Router::post('/events', function ($params, $body) {
    $user = require_admin();
    $title = $body['title'] ?? null;
    $eventDate = $body['event_date'] ?? null;
    if (!$title || !$eventDate) {
        throw new ApiError(400, 'title and event_date are required');
    }
    $info = db_run(
        'INSERT INTO events (title, description, event_date, venue) VALUES (?, ?, ?, ?)',
        [$title, $body['description'] ?? null, $eventDate, $body['venue'] ?? null]
    );
    $event = db_get('SELECT * FROM events WHERE id = ?', [$info['insertId']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'create',
        'entityType' => 'event',
        'entityId' => $event['id'],
        'description' => "Added event {$event['title']} ({$event['event_date']})",
    ]);
    Response::json($event, 201);
});

Router::put('/events/:id', function ($params, $body) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM events WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Event not found');
    }
    db_run(
        'UPDATE events SET title = ?, description = ?, event_date = ?, venue = ? WHERE id = ?',
        [
            $body['title'] ?? $existing['title'],
            $body['description'] ?? $existing['description'],
            $body['event_date'] ?? $existing['event_date'],
            $body['venue'] ?? $existing['venue'],
            $params['id'],
        ]
    );
    $event = db_get('SELECT * FROM events WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'event',
        'entityId' => $event['id'],
        'description' => "Updated event {$event['title']} ({$event['event_date']})",
    ]);
    Response::json($event);
});

Router::delete('/events/:id', function ($params) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM events WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Event not found');
    }
    db_run('DELETE FROM events WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'delete',
        'entityType' => 'event',
        'entityId' => $existing['id'],
        'description' => "Deleted event {$existing['title']} ({$existing['event_date']})",
    ]);
    Response::json(['ok' => true]);
});
