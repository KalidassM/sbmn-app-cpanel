<?php
// SBIePay (SBI's payment aggregator) integration, offered as a second gateway alongside Razorpay
// (see php/utils/razorpay.php) - the payer picks whichever is configured.
//
// sbiepay_create_order() and sbiepay_verify_signature() are deliberately left unimplemented.
// Unlike Razorpay, SBIePay's request-encryption and response-checksum scheme is not public - it
// is only handed out in a merchant-specific "Merchant Integration Document" once onboarded with
// SBI. Guessing that scheme for money-moving code is unsafe in both directions:
//  - Get the request encryption wrong and real payments fail to even reach SBI.
//  - Get the response checksum verification wrong (or skip it) and ANYONE can hit the verify/
//    callback endpoint with fabricated parameters and have a payment marked "paid" for free.
// Once you have that document, fill in the two functions below to match it exactly. Everything
// else in this app (settings storage, admin UI, DB columns) is already wired to call them.

function sbiepay_gateway_settings(): array
{
    return db_get('SELECT sbiepay_merchant_id, sbiepay_secret_key, payee_name FROM payment_settings WHERE id = 1') ?? [];
}

function sbiepay_is_configured(): bool
{
    $s = sbiepay_gateway_settings();
    return !empty($s['sbiepay_merchant_id']) && !empty($s['sbiepay_secret_key']);
}

// TODO(sbiepay): build the encrypted order request per SBI's Merchant Integration Document
// (typically an AES-encrypted, pipe-delimited param string posted to their hosted payment page)
// and return whatever the caller needs to hand the payer to that page (e.g. an order/reference
// id plus the encrypted request blob and the exact form-post URL).
function sbiepay_create_order(int $amountPaise, string $receipt, array $notes = []): array
{
    throw new RuntimeException(
        'SBIePay is not implemented yet - sbiepay_create_order() needs the real request format '
        . 'from SBI\'s Merchant Integration Document. See php/utils/sbiepay.php.'
    );
}

// TODO(sbiepay): verify the response/callback per SBI's document (typically decrypting and/or
// checksumming the returned params with the secret key) before trusting $responseParams at all.
// This MUST cryptographically prove the response came from SBI unmodified - never mark a payment
// paid just because a request arrived at this endpoint with plausible-looking fields.
function sbiepay_verify_signature(array $responseParams, string $secretKey): bool
{
    throw new RuntimeException(
        'SBIePay is not implemented yet - sbiepay_verify_signature() needs the real checksum/'
        . 'encryption scheme from SBI\'s Merchant Integration Document. See php/utils/sbiepay.php.'
    );
}
