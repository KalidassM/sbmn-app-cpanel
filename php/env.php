<?php
// Minimal .env loader - no Composer dependency needed. Reads KEY=VALUE lines from the .env file
// one level above the web root (never web-accessible), same file/vars the old Node app used.

function load_env(string $path): void
{
    if (!is_file($path)) {
        return;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        if ($key === '') {
            continue;
        }
        if (getenv($key) === false) {
            putenv("$key=$value");
        }
        $_ENV[$key] = $value;
    }
}

function env(string $key, $default = null)
{
    $value = getenv($key);
    return $value === false || $value === '' ? $default : $value;
}

load_env(__DIR__ . '/../.env');
