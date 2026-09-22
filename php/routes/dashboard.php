<?php

Router::get('/dashboard/summary', function () {
    require_auth();
    $memberCount = (int) (db_get("SELECT COUNT(*) AS c FROM members WHERE status = 'active'")['c']);
    $inactiveMemberCount = (int) (db_get("SELECT COUNT(*) AS c FROM members WHERE status = 'inactive'")['c']);
    $coreMemberCount = (int) (db_get('SELECT COUNT(*) AS c FROM core_members WHERE end_date IS NULL')['c']);
    $upcomingEvents = (int) (db_get('SELECT COUNT(*) AS c FROM events WHERE event_date >= CURDATE()')['c']);
    $noticeCount = (int) (db_get('SELECT COUNT(*) AS c FROM notices')['c']);
    $totalExpenses = (float) (db_get('SELECT COALESCE(SUM(amount), 0) AS s FROM expenses')['s']);
    $totalDonations = (float) (db_get("SELECT COALESCE(SUM(amount), 0) AS s FROM donations WHERE status = 'completed'")['s']);
    // Lifetime total - feeds the running bank balance below, which must reflect all-time collections,
    // not just the current month.
    $totalMaintenanceCollected = (float) (db_get('SELECT COALESCE(SUM(amount_paid), 0) AS s FROM maintenance_payments')['s']);

    $month = (int) (new DateTime())->format('n');
    $year = (int) (new DateTime())->format('Y');
    $maintenanceCollectedThisMonth = (float) (db_get(
        'SELECT COALESCE(SUM(amount_paid), 0) AS s FROM maintenance_payments WHERE month = ? AND year = ?',
        [$month, $year]
    )['s']);
    $totalMaintenanceDue = (float) (db_get(
        "SELECT COALESCE(SUM(mp.amount_due - mp.amount_paid), 0) AS s
         FROM maintenance_payments mp
         JOIN members m ON m.id = mp.member_id
         WHERE mp.status != 'paid' AND mp.month = ? AND mp.year = ? AND m.status = 'active'",
        [$month, $year]
    )['s']);

    $balance = $totalMaintenanceCollected + $totalDonations - $totalExpenses;

    Response::json([
        'memberCount' => $memberCount,
        'inactiveMemberCount' => $inactiveMemberCount,
        'coreMemberCount' => $coreMemberCount,
        'upcomingEvents' => $upcomingEvents,
        'noticeCount' => $noticeCount,
        'totalExpenses' => $totalExpenses,
        'totalDonations' => $totalDonations,
        'totalMaintenanceCollected' => $totalMaintenanceCollected,
        'maintenanceCollectedThisMonth' => $maintenanceCollectedThisMonth,
        'totalMaintenanceDue' => $totalMaintenanceDue,
        'balance' => $balance,
    ]);
});
