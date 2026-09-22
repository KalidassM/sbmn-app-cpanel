<?php

// Indian financial year runs April-March; "fy" query param is "YYYY-YY", e.g. "2025-26"
function reports_fy_range(?string $fy): ?array
{
    if (!$fy || !preg_match('/^(\d{4})-(\d{2})$/', $fy, $m)) {
        return null;
    }
    $startYear = (int) $m[1];
    return ['start' => "$startYear-04-01", 'end' => ($startYear + 1) . '-03-31'];
}

Router::get('/reports/itr-summary', function ($params, $body, $query) {
    require_admin();
    $fy = $query['fy'] ?? null;
    $from = $query['from'] ?? null;
    $to = $query['to'] ?? null;
    $fyLabel = null;

    if ($from || $to) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $to)) {
            throw new ApiError(400, 'from/to must both be provided in YYYY-MM-DD format');
        }
        if ($from > $to) {
            throw new ApiError(400, 'From date must not be after To date');
        }
        $range = ['start' => $from, 'end' => $to];
    } else {
        $range = reports_fy_range($fy);
        if (!$range) {
            throw new ApiError(400, 'fy must be in YYYY-YY format, e.g. 2025-26, or provide from/to dates');
        }
        $fyLabel = $fy;
    }
    $start = $range['start'];
    $end = $range['end'];

    // Cash basis: dues counted when actually paid (paid_date), not the due period they were billed for
    $maintenancePayments = db_all(
        'SELECT mp.id, mp.member_id, m.name AS member_name, m.site_no, mp.month, mp.year,
                mp.amount_paid, mp.paid_date, mp.payment_mode, mp.reference_no
         FROM maintenance_payments mp JOIN members m ON m.id = mp.member_id
         WHERE mp.amount_paid > 0 AND mp.paid_date BETWEEN ? AND ?
         ORDER BY mp.paid_date',
        [$start, $end]
    );

    $donations = db_all(
        'SELECT d.id, d.member_id, COALESCE(m.name, d.donor_name) AS donor_name, d.amount, d.donation_date, d.purpose
         FROM donations d LEFT JOIN members m ON m.id = d.member_id
         WHERE d.donation_date BETWEEN ? AND ?
         ORDER BY d.donation_date',
        [$start, $end]
    );

    $expenseRows = db_all(
        'SELECT id, title, category, amount, expense_date, source, notes
         FROM expenses WHERE expense_date BETWEEN ? AND ? ORDER BY expense_date',
        [$start, $end]
    );

    $maintenanceTotal = array_sum(array_map(fn ($p) => (float) $p['amount_paid'], $maintenancePayments));
    $donationsTotal = array_sum(array_map(fn ($d) => (float) $d['amount'], $donations));

    $expensesByCategory = [];
    $expensesBySource = ['bank' => 0, 'petty_cash' => 0];
    $expensesTotal = 0;
    foreach ($expenseRows as $e) {
        $cat = $e['category'] ?: 'Uncategorized';
        $expensesByCategory[$cat] = ($expensesByCategory[$cat] ?? 0) + (float) $e['amount'];
        $expensesBySource[$e['source']] = ($expensesBySource[$e['source']] ?? 0) + (float) $e['amount'];
        $expensesTotal += (float) $e['amount'];
    }

    $association = db_get('SELECT app_name, contact_email, office_address, phone_number FROM general_settings WHERE id = 1');

    $incomeTotal = $maintenanceTotal + $donationsTotal;

    Response::json([
        'fy' => $fyLabel,
        'dateRange' => ['start' => $start, 'end' => $end],
        'association' => $association ?: [],
        'income' => ['maintenance' => $maintenanceTotal, 'donations' => $donationsTotal, 'total' => $incomeTotal],
        'expenses' => [
            'byCategory' => array_map(fn ($category, $amount) => ['category' => $category, 'amount' => $amount], array_keys($expensesByCategory), array_values($expensesByCategory)),
            'bySource' => $expensesBySource,
            'total' => $expensesTotal,
        ],
        'net' => $incomeTotal - $expensesTotal,
        'details' => ['maintenancePayments' => $maintenancePayments, 'donations' => $donations, 'expenses' => $expenseRows],
    ]);
});
