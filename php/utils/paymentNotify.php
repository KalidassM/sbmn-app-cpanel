<?php

// Emails the association's contact address whenever a maintenance due gets a payment recorded
// against it (full or partial). Never throws - a notification failure must not break the payment.
function notify_admin_of_payment(array $due): void
{
    try {
        if (!is_email_configured()) {
            return;
        }
        $settings = db_get('SELECT contact_email FROM general_settings WHERE id = 1');
        $to = $settings['contact_email'] ?? null;
        if (!$to) {
            return;
        }

        $member = db_get('SELECT name, site_no FROM members WHERE id = ?', [$due['member_id']]);
        $html = '
            <p>A maintenance payment was recorded.</p>
            <table cellpadding="4">
              <tr><td><strong>Member</strong></td><td>' . ($member['name'] ?? 'Unknown') . ' (Site No ' . ($member['site_no'] ?? '-') . ')</td></tr>
              <tr><td><strong>Month</strong></td><td>' . MONTH_NAMES[$due['month']] . ' ' . $due['year'] . '</td></tr>
              <tr><td><strong>Amount Paid</strong></td><td>₹' . $due['amount_paid'] . ' of ₹' . $due['amount_due'] . '</td></tr>
              <tr><td><strong>Status</strong></td><td>' . $due['status'] . '</td></tr>
              <tr><td><strong>Mode</strong></td><td>' . ($due['payment_mode'] ?? '-') . '</td></tr>
              <tr><td><strong>Reference</strong></td><td>' . ($due['reference_no'] ?? '-') . '</td></tr>
              <tr><td><strong>Paid Date</strong></td><td>' . ($due['paid_date'] ?? '-') . '</td></tr>
            </table>
        ';
        send_mail($to, 'Maintenance payment received - ' . ($member['name'] ?? 'member'), $html);
    } catch (Throwable $e) {
        error_log('Payment notification email failed: ' . $e->getMessage());
    }
}

// Sends a payment success confirmation to the paying member (WhatsApp + email, whichever are
// configured and on file) and a WhatsApp-only heads-up to the association's own contact number,
// for one or more dues paid together. Never throws.
function notify_payment_whatsapp(array $dues): void
{
    try {
        if (!$dues) {
            return;
        }

        $member = db_get('SELECT name, site_no, phone, email FROM members WHERE id = ?', [$dues[0]['member_id']]);
        if (!$member) {
            return;
        }

        $settings = db_get('SELECT phone_number FROM general_settings WHERE id = 1');
        $totalPaid = array_sum(array_map(fn ($d) => (float) $d['amount_paid'], $dues));
        $monthsText = implode(', ', array_map(fn ($d) => MONTH_NAMES[$d['month']] . ' ' . $d['year'], $dues));
        $monthWord = count($dues) > 1 ? count($dues) . ' months' : '1 month';
        $signature = sign_off();

        $memberText = "Hi {$member['name']}, your payment of ₹$totalPaid for $monthsText has been received. Thank you!\n\n$signature";
        if (!empty($member['phone']) && wa_is_connected()) {
            try {
                wa_send_message($member['phone'], $memberText);
            } catch (Throwable $e) {
                error_log('Payment WhatsApp to member failed: ' . $e->getMessage());
            }
        }
        if (!empty($member['email']) && is_email_configured()) {
            try {
                send_mail($member['email'], 'Payment received - ' . app_name(), text_to_html($memberText));
            } catch (Throwable $e) {
                error_log('Payment email to member failed: ' . $e->getMessage());
            }
        }

        if (!empty($settings['phone_number']) && wa_is_connected()) {
            try {
                wa_send_message($settings['phone_number'], "Payment received: ₹$totalPaid from {$member['name']} (Site No " . ($member['site_no'] ?: '-') . ") for $monthsText ($monthWord).\n\n$signature");
            } catch (Throwable $e) {
                error_log('Payment WhatsApp to admin failed: ' . $e->getMessage());
            }
        }
    } catch (Throwable $e) {
        error_log('Payment notification failed: ' . $e->getMessage());
    }
}

// Sends a donation success confirmation to the donor (WhatsApp + email, whichever are configured
// and on file) and a WhatsApp-only heads-up to the association's own contact number, once a
// donation is confirmed/verified as paid. Never throws. The donor's phone/email come from the
// members table for a self-donation (member_id set), or donor_phone/donor_email for a public
// well-wisher donation - whichever is on file.
function notify_donation_whatsapp(?array $donation): void
{
    try {
        if (!$donation) {
            return;
        }

        $donorPhone = $donation['donor_phone'] ?? null;
        $donorEmail = $donation['donor_email'] ?? null;
        $donorName = $donation['donor_name'] ?? null;
        if (!empty($donation['member_id'])) {
            $member = db_get('SELECT name, phone, email FROM members WHERE id = ?', [$donation['member_id']]);
            if ($member) {
                $donorPhone = $donorPhone ?: $member['phone'];
                $donorEmail = $donorEmail ?: $member['email'];
                $donorName = $donorName ?: $member['name'];
            }
        }
        $donorName = $donorName ?: 'Donor';

        $settings = db_get('SELECT phone_number FROM general_settings WHERE id = 1');
        $purposeText = !empty($donation['purpose']) ? " for {$donation['purpose']}" : '';
        $signature = sign_off();

        $donorText = "Hi $donorName, thank you! Your donation of ₹{$donation['amount']}$purposeText has been received.\n\n$signature";
        if ($donorPhone && wa_is_connected()) {
            try {
                wa_send_message($donorPhone, $donorText);
            } catch (Throwable $e) {
                error_log('Donation WhatsApp to donor failed: ' . $e->getMessage());
            }
        }
        if ($donorEmail && is_email_configured()) {
            try {
                send_mail($donorEmail, 'Thank you for your donation - ' . app_name(), text_to_html($donorText));
            } catch (Throwable $e) {
                error_log('Donation email to donor failed: ' . $e->getMessage());
            }
        }

        if (!empty($settings['phone_number']) && wa_is_connected()) {
            try {
                wa_send_message($settings['phone_number'], "Donation received: ₹{$donation['amount']} from $donorName$purposeText.\n\n$signature");
            } catch (Throwable $e) {
                error_log('Donation WhatsApp to admin failed: ' . $e->getMessage());
            }
        }
    } catch (Throwable $e) {
        error_log('Donation notification failed: ' . $e->getMessage());
    }
}
