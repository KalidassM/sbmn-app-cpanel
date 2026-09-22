<?php

Router::get('/expenses', function ($params, $body, $query) {
    require_auth();
    $sql = 'SELECT * FROM expenses';
    $clauses = [];
    $sqlParams = [];
    if (!empty($query['year'])) {
        $clauses[] = 'YEAR(expense_date) = ?';
        $sqlParams[] = (int) $query['year'];
    }
    if (!empty($query['month'])) {
        $clauses[] = 'MONTH(expense_date) = ?';
        $sqlParams[] = (int) $query['month'];
    }
    if ($clauses) {
        $sql .= ' WHERE ' . implode(' AND ', $clauses);
    }
    $sql .= ' ORDER BY expense_date DESC';
    Response::json(db_all($sql, $sqlParams));
});

Router::post('/expenses', function ($params, $body) {
    $user = require_admin();
    $title = $body['title'] ?? null;
    $amount = $body['amount'] ?? null;
    if (!$title || $amount === null) {
        throw new ApiError(400, 'title and amount are required');
    }
    $info = db_run(
        'INSERT INTO expenses (title, category, amount, expense_date, event_id, notes)
         VALUES (?, ?, ?, COALESCE(?, CURDATE()), ?, ?)',
        [$title, $body['category'] ?? null, $amount, $body['expense_date'] ?? null, $body['event_id'] ?? null, $body['notes'] ?? null]
    );
    $expense = db_get('SELECT * FROM expenses WHERE id = ?', [$info['insertId']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'create',
        'entityType' => 'expense',
        'entityId' => $expense['id'],
        'description' => "Added expense \"{$expense['title']}\" of ₹{$expense['amount']}",
    ]);
    Response::json($expense, 201);
});

Router::put('/expenses/:id', function ($params, $body) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM expenses WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Expense not found');
    }
    db_run(
        'UPDATE expenses SET title = ?, category = ?, amount = ?, expense_date = ?, event_id = ?, notes = ? WHERE id = ?',
        [
            $body['title'] ?? $existing['title'],
            $body['category'] ?? $existing['category'],
            $body['amount'] ?? $existing['amount'],
            $body['expense_date'] ?? $existing['expense_date'],
            array_key_exists('event_id', $body) ? $body['event_id'] : $existing['event_id'],
            $body['notes'] ?? $existing['notes'],
            $params['id'],
        ]
    );
    $expense = db_get('SELECT * FROM expenses WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'expense',
        'entityId' => $expense['id'],
        'description' => "Updated expense \"{$expense['title']}\" of ₹{$expense['amount']}",
    ]);
    Response::json($expense);
});

Router::delete('/expenses/:id', function ($params) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM expenses WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Expense not found');
    }
    db_run('DELETE FROM expenses WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'delete',
        'entityType' => 'expense',
        'entityId' => $existing['id'],
        'description' => "Deleted expense \"{$existing['title']}\" of ₹{$existing['amount']}",
    ]);
    Response::json(['ok' => true]);
});
