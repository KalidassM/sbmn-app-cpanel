<?php

Router::get('/public/site/summary', function () {
    $householdCount = (int) (db_get("SELECT COUNT(*) AS c FROM members WHERE status = 'active'")['c']);
    $activeNotices = (int) (db_get('SELECT COUNT(*) AS c FROM notices')['c']);
    $upcomingEvents = (int) (db_get('SELECT COUNT(*) AS c FROM events WHERE event_date >= CURDATE()')['c']);
    Response::json(['householdCount' => $householdCount, 'activeNotices' => $activeNotices, 'upcomingEvents' => $upcomingEvents]);
});

// Non-secret association profile fields (name/contact/address) for the public site to display
Router::get('/public/site/profile', function () {
    $row = db_get('SELECT app_name, contact_email, office_address, office_hours, phone_number FROM general_settings WHERE id = 1');
    Response::json($row ?: []);
});

Router::get('/public/site/notices', function () {
    Response::json(db_all('SELECT * FROM notices ORDER BY pinned DESC, created_at DESC'));
});

Router::get('/public/site/events', function () {
    Response::json(db_all('SELECT id, title, description, event_date, venue FROM events ORDER BY event_date DESC'));
});

Router::get('/public/site/committee', function () {
    Response::json(db_all(
        'SELECT cm.id, cm.designation, cm.photo, m.name AS member_name, m.phone AS member_phone
         FROM core_members cm
         JOIN members m ON m.id = cm.member_id
         WHERE cm.end_date IS NULL
         ORDER BY cm.start_date ASC'
    ));
});

Router::post('/public/site/contact-messages', function ($params, $body) {
    $cleanName = trim((string) ($body['name'] ?? ''));
    $cleanPhone = trim((string) ($body['phone'] ?? ''));
    $cleanMessage = trim((string) ($body['message'] ?? ''));
    if (!$cleanName || !$cleanPhone || !$cleanMessage) {
        throw new ApiError(400, 'Name, phone and message are required');
    }
    db_run(
        'INSERT INTO contact_messages (name, house_no, phone, email, message) VALUES (?, ?, ?, ?, ?)',
        [
            mb_substr($cleanName, 0, 120),
            mb_substr(trim((string) ($body['house_no'] ?? '')), 0, 40) ?: null,
            mb_substr($cleanPhone, 0, 32),
            mb_substr(trim((string) ($body['email'] ?? '')), 0, 160) ?: null,
            mb_substr($cleanMessage, 0, 1000),
        ]
    );
    Response::json(['ok' => true], 201);
});
