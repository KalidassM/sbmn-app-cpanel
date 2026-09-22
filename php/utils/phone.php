<?php
// Extracts a clean 10-digit phone number to use as a username - members sometimes have more than
// one number on file (e.g. "9688502997 / 8072006482"), so this takes the first usable one and
// strips any country code/formatting, matching the convention already used for WhatsApp sends.
function first_phone_digits(?string $phone): ?string
{
    if (!$phone) {
        return null;
    }
    $candidates = preg_split('#[/,]|\s+(?:or|and)\s+#i', $phone);
    foreach ($candidates as $candidate) {
        $digits = preg_replace('/\D/', '', $candidate);
        if (strlen($digits) >= 10) {
            return substr($digits, -10);
        }
    }
    return null;
}
