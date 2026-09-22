<?php

final class Router
{
    private static array $routes = [];

    public static function get(string $pattern, callable $handler): void
    {
        self::add('GET', $pattern, $handler);
    }

    public static function post(string $pattern, callable $handler): void
    {
        self::add('POST', $pattern, $handler);
    }

    public static function put(string $pattern, callable $handler): void
    {
        self::add('PUT', $pattern, $handler);
    }

    public static function delete(string $pattern, callable $handler): void
    {
        self::add('DELETE', $pattern, $handler);
    }

    private static function add(string $method, string $pattern, callable $handler): void
    {
        self::$routes[] = [$method, $pattern, $handler];
    }

    // Parses the JSON request body once, matching the old Express app's `express.json()`
    // middleware - route handlers receive it as a plain assoc array (or [] if absent/invalid).
    private static function body(): array
    {
        static $body = null;
        if ($body === null) {
            $raw = file_get_contents('php://input');
            $decoded = $raw ? json_decode($raw, true) : null;
            $body = is_array($decoded) ? $decoded : [];
        }
        return $body;
    }

    public static function dispatch(string $method, string $path): void
    {
        foreach (self::$routes as [$m, $pattern, $handler]) {
            if ($m !== $method) {
                continue;
            }
            $paramNames = [];
            $regex = preg_replace_callback('#:([a-zA-Z_]+)#', function ($matches) use (&$paramNames) {
                $paramNames[] = $matches[1];
                return '([^/]+)';
            }, $pattern);
            if (!preg_match('#^' . $regex . '$#', $path, $matches)) {
                continue;
            }
            array_shift($matches);
            $params = array_combine($paramNames, array_map('urldecode', $matches));

            try {
                $handler($params, self::body(), $_GET);
            } catch (ApiError $e) {
                Response::json(['error' => $e->getMessage()], $e->getStatus());
            } catch (Throwable $e) {
                error_log('Unhandled API error: ' . $e->getMessage());
                Response::json(['error' => 'Internal server error'], 500);
            }
            return;
        }
        Response::json(['error' => 'Not found'], 404);
    }
}
