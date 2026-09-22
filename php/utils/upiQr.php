<?php
// Renders the UPI payment URI as a QR code PNG. There's no QR-encoding extension bundled with
// PHP and no dependency-free way to draw one in pure PHP without vendoring a whole encoder, so
// this calls the free public api.qrserver.com image API and returns the PNG as a data URL -
// functionally identical to what the old Node app's `qrcode` package produced client-side.
function build_upi_qr(float $amount, ?string $note): array
{
    $settings = db_get('SELECT upi_id, payee_name FROM payment_settings WHERE id = 1');
    if (empty($settings['upi_id'])) {
        throw new RuntimeException('UPI ID has not been configured yet. Ask an admin to set it up in Payment Settings.');
    }
    if ($amount <= 0) {
        throw new RuntimeException('A valid amount is required');
    }

    $params = [
        'pa' => $settings['upi_id'],
        'pn' => $settings['payee_name'] ?: 'Sri Balamurugan Nagar Welfare Association',
        'am' => number_format($amount, 2, '.', ''),
        'cu' => 'INR',
        'tn' => mb_substr($note ?: 'Association payment', 0, 60),
    ];
    $upiUri = 'upi://pay?' . http_build_query($params);

    $qrImageUrl = 'https://api.qrserver.com/v1/create-qr-code/?' . http_build_query([
        'size' => '260x260',
        'margin' => 1,
        'data' => $upiUri,
    ]);
    $ch = curl_init($qrImageUrl);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
    $png = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!$png || $status < 200 || $status >= 300) {
        throw new RuntimeException('Could not generate the QR code image. Please try again.');
    }

    return [
        'upiUri' => $upiUri,
        'qrDataUrl' => 'data:image/png;base64,' . base64_encode($png),
    ];
}
