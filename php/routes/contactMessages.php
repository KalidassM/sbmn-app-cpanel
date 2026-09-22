<?php

Router::get('/contact-messages', function () {
    require_admin();
    Response::json(db_all('SELECT * FROM contact_messages ORDER BY created_at DESC'));
});

Router::delete('/contact-messages/:id', function ($params) {
    require_admin();
    $existing = db_get('SELECT * FROM contact_messages WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Message not found');
    }
    db_run('DELETE FROM contact_messages WHERE id = ?', [$params['id']]);
    Response::json(['ok' => true]);
});
