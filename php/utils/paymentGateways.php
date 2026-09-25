<?php
// Whether each payment gateway should actually be offered to payers - combines what's configured
// (razorpay_is_configured()/sbiepay_is_configured()) with the admin's choice of which to display
// (payment_settings.gateway_display: 'both', 'razorpay', or 'sbiepay' - see
// php/routes/paymentSettings.php). Lets an admin hide a configured-but-not-yet-working gateway
// (e.g. SBIePay before its real integration is done) without clearing its saved keys.

function payment_gateway_display(): string
{
    $row = db_get('SELECT gateway_display FROM payment_settings WHERE id = 1');
    return $row['gateway_display'] ?? 'both';
}

function razorpay_should_show(): bool
{
    return payment_gateway_display() !== 'sbiepay' && razorpay_is_configured();
}

function sbiepay_should_show(): bool
{
    return payment_gateway_display() !== 'razorpay' && sbiepay_is_configured();
}
