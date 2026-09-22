<?php

function petty_cash_summary(): array
{
    $totalTopups = (float) (db_get("SELECT COALESCE(SUM(amount), 0) AS s FROM petty_cash_transactions WHERE type = 'topup'")['s'] ?? 0);
    $totalExpenses = (float) (db_get("SELECT COALESCE(SUM(amount), 0) AS s FROM petty_cash_transactions WHERE type = 'expense'")['s'] ?? 0);
    return ['totalTopups' => $totalTopups, 'totalExpenses' => $totalExpenses, 'balance' => $totalTopups - $totalExpenses];
}

Router::get('/petty-cash', function () {
    require_auth();
    $transactions = db_all('SELECT * FROM petty_cash_transactions ORDER BY txn_date DESC, id DESC');
    Response::json(['transactions' => $transactions, 'summary' => petty_cash_summary()]);
});

Router::post('/petty-cash', function ($params, $body) {
    $user = require_admin();
    $type = $body['type'] ?? null;
    $amount = $body['amount'] ?? null;
    $description = $body['description'] ?? null;
    if (!in_array($type, ['topup', 'expense'], true)) {
        throw new ApiError(400, "type must be 'topup' or 'expense'");
    }
    if (!$amount || $amount <= 0) {
        throw new ApiError(400, 'A valid amount is required');
    }
    if (!$description || !trim($description)) {
        throw new ApiError(400, 'Description is required');
    }
    $date = $body['txn_date'] ?? (new DateTime())->format('Y-m-d');
    $description = trim($description);
    $category = $body['category'] ?? null;

    $id = db_transaction(function () use ($type, $amount, $date, $description, $category) {
        $expenseId = null;
        if ($type === 'expense') {
            $expenseInfo = db_run(
                "INSERT INTO expenses (title, category, amount, expense_date, source, notes)
                 VALUES (?, ?, ?, ?, 'petty_cash', 'Paid from petty cash')",
                [$description, $category ?: 'Petty Cash', $amount, $date]
            );
            $expenseId = $expenseInfo['insertId'];
        }
        $info = db_run(
            'INSERT INTO petty_cash_transactions (type, amount, txn_date, description, category, expense_id)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$type, $amount, $date, $description, $category ?: null, $expenseId]
        );
        return $info['insertId'];
    });

    $row = db_get('SELECT * FROM petty_cash_transactions WHERE id = ?', [$id]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'create',
        'entityType' => 'petty_cash',
        'entityId' => $row['id'],
        'description' => "Added {$row['type']} of ₹{$row['amount']} - {$row['description']}",
    ]);
    Response::json(['transaction' => $row, 'summary' => petty_cash_summary()], 201);
});

// Type is fixed on edit (flipping topup<->expense would require creating/removing the linked
// expense row); amount/date/description/category can be corrected, and stay in sync with the
// linked expenses row if this transaction is a petty-cash expense.
Router::put('/petty-cash/:id', function ($params, $body) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM petty_cash_transactions WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Transaction not found');
    }
    if (array_key_exists('amount', $body) && (!$body['amount'] || $body['amount'] <= 0)) {
        throw new ApiError(400, 'A valid amount is required');
    }
    $finalAmount = $body['amount'] ?? $existing['amount'];
    $finalDate = $body['txn_date'] ?? $existing['txn_date'];
    $finalDescription = (!empty($body['description']) && trim($body['description'])) ? trim($body['description']) : $existing['description'];
    $finalCategory = array_key_exists('category', $body) ? ($body['category'] ?: null) : $existing['category'];

    db_transaction(function () use ($finalAmount, $finalDate, $finalDescription, $finalCategory, $params, $existing) {
        db_run(
            'UPDATE petty_cash_transactions SET amount = ?, txn_date = ?, description = ?, category = ? WHERE id = ?',
            [$finalAmount, $finalDate, $finalDescription, $finalCategory, $params['id']]
        );
        if ($existing['expense_id']) {
            db_run('UPDATE expenses SET title = ?, category = ?, amount = ?, expense_date = ? WHERE id = ?', [
                $finalDescription,
                $finalCategory ?: 'Petty Cash',
                $finalAmount,
                $finalDate,
                $existing['expense_id'],
            ]);
        }
    });

    $row = db_get('SELECT * FROM petty_cash_transactions WHERE id = ?', [$params['id']]);
    log_activity([
        'actor' => $user['username'],
        'action' => 'update',
        'entityType' => 'petty_cash',
        'entityId' => $row['id'],
        'description' => "Updated {$row['type']} of ₹{$row['amount']} - {$row['description']}",
    ]);
    Response::json(['transaction' => $row, 'summary' => petty_cash_summary()]);
});

Router::delete('/petty-cash/:id', function ($params) {
    $user = require_admin();
    $existing = db_get('SELECT * FROM petty_cash_transactions WHERE id = ?', [$params['id']]);
    if (!$existing) {
        throw new ApiError(404, 'Transaction not found');
    }

    db_transaction(function () use ($existing, $params) {
        if ($existing['expense_id']) {
            db_run('DELETE FROM expenses WHERE id = ?', [$existing['expense_id']]);
        }
        db_run('DELETE FROM petty_cash_transactions WHERE id = ?', [$params['id']]);
    });

    log_activity([
        'actor' => $user['username'],
        'action' => 'delete',
        'entityType' => 'petty_cash',
        'entityId' => $existing['id'],
        'description' => "Deleted {$existing['type']} of ₹{$existing['amount']} - {$existing['description']}",
    ]);
    Response::json(['ok' => true, 'summary' => petty_cash_summary()]);
});
