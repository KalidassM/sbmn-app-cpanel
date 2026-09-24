<?php
// Thin PDO wrapper. Function names/shapes mirror the old Node app's db.js shim
// (db_get/db_all/db_run/db_transaction) so the route-by-route port below reads almost line-for-line
// against the Express version this replaced.

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $host = env('DB_HOST', 'localhost');
        $port = env('DB_PORT', '3306');
        $name = env('DB_NAME');
        $dsn = "mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4";
        $pdo = new PDO($dsn, env('DB_USER'), env('DB_PASSWORD'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => true,
        ]);
    }
    return $pdo;
}

function db_get(string $sql, array $params = []): ?array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

function db_all(string $sql, array $params = []): array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

function db_run(string $sql, array $params = []): array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return [
        'insertId' => (int) db()->lastInsertId(),
        'changes' => $stmt->rowCount(),
    ];
}

function db_transaction(callable $fn)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $fn();
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function db_column_exists(string $table, string $column): bool
{
    $row = db_get(
        'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
        [$table, $column]
    );
    return (int) $row['c'] > 0;
}

// Self-healing schema check, run once per request boot (see bootstrap.php) - cheap (a couple of
// tiny lookups) and idempotent, so it applies automatically in every environment (local dev now,
// production later) with no manual SQL step, the same way the original app's schema evolved.
function db_migrate(): void
{
    if (!db_column_exists('general_settings', 'reminder_channels')) {
        db()->exec("ALTER TABLE general_settings ADD COLUMN reminder_channels VARCHAR(30) NOT NULL DEFAULT 'whatsapp,email'");
    }
}
