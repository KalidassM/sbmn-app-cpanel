<?php
// Fills in due rows (using the general-settings monthly amount) for any active member who doesn't
// already have one for this month/year. Never touches an existing row, so manual corrections and
// payments already recorded are never overwritten by a later view of the same month.
function ensure_dues_generated(int $month, int $year): void
{
    $settings = db_get('SELECT maintenance_amount FROM general_settings WHERE id = 1');
    if (empty($settings['maintenance_amount'])) {
        return;
    }

    // Skip members who hadn't joined yet as of this month/year - no due should exist for a period
    // before someone became a member.
    $period = $year * 100 + $month;
    $members = db_all(
        "SELECT id FROM members
         WHERE status = 'active'
           AND (YEAR(join_date) * 100 + MONTH(join_date)) <= ?",
        [$period]
    );

    db_transaction(function () use ($members, $month, $year, $settings) {
        foreach ($members as $m) {
            db_run(
                "INSERT IGNORE INTO maintenance_payments (member_id, month, year, amount_due, amount_paid, status)
                 VALUES (?, ?, ?, ?, 0, 'unpaid')",
                [$m['id'], $month, $year, $settings['maintenance_amount']]
            );
        }
    });
}
