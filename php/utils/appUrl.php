<?php
// Resolves the public URL of this deployment - set APP_PUBLIC_URL to the cPanel domain in
// production; falls back to localhost for local dev.
function base_url(): string
{
    $url = env('APP_PUBLIC_URL');
    return $url ? rtrim($url, '/') : 'http://localhost';
}

function portal_url(): string
{
    return base_url() . '/portal';
}
