<?php
// Talks to Razorpay's plain REST API directly (Basic Auth + cURL) instead of via their SDK - no
// Composer dependency needed, so this app has zero third-party PHP packages to install on cPanel.

function razorpay_gateway_settings(): array
{
    return db_get('SELECT razorpay_key_id, razorpay_key_secret, payee_name FROM payment_settings WHERE id = 1') ?? [];
}

function razorpay_is_configured(): bool
{
    $s = razorpay_gateway_settings();
    return !empty($s['razorpay_key_id']) && !empty($s['razorpay_key_secret']);
}

// Returns the created order (assoc array) or throws RuntimeException with Razorpay's error message.
function razorpay_create_order(int $amountPaise, string $receipt, array $notes = []): array
{
    $s = razorpay_gateway_settings();
    if (empty($s['razorpay_key_id']) || empty($s['razorpay_key_secret'])) {
        throw new RuntimeException('Razorpay is not configured');
    }

    $ch = curl_init('https://api.razorpay.com/v1/orders');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_USERPWD => $s['razorpay_key_id'] . ':' . $s['razorpay_key_secret'],
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode([
            'amount' => $amountPaise,
            'currency' => 'INR',
            'receipt' => $receipt,
            'notes' => $notes,
        ]),
    ]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $data = json_decode($body ?: 'null', true);
    if ($status < 200 || $status >= 300 || !isset($data['id'])) {
        throw new RuntimeException($data['error']['description'] ?? "Razorpay order creation failed ($status)");
    }
    return $data;
}

function razorpay_verify_signature(string $orderId, string $paymentId, string $signature, string $secret): bool
{
    $expected = hash_hmac('sha256', "$orderId|$paymentId", $secret);
    return hash_equals($expected, $signature);
}
