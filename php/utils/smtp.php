<?php
// SMTP sending via PHPMailer (vendored directly under php/vendor/PHPMailer - no Composer, same
// no-vendor-packages approach used for Razorpay/WhatsApp/the QR code). Lets an admin send via
// their own mailbox's SMTP server instead of a third-party API like Resend.

require_once __DIR__ . '/../vendor/PHPMailer/Exception.php';
require_once __DIR__ . '/../vendor/PHPMailer/SMTP.php';
require_once __DIR__ . '/../vendor/PHPMailer/PHPMailer.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as PHPMailerException;

function smtp_send_mail(array $settings, string $to, string $subject, string $html): void
{
    $host = $settings['smtp_host'] ?? '';
    $port = (int) ($settings['smtp_port'] ?: 587);
    $secure = $settings['smtp_secure'] ?: 'tls'; // 'ssl' (implicit TLS, usually port 465), 'tls' (STARTTLS, usually 587), 'none'
    $username = $settings['smtp_username'] ?? '';
    $password = $settings['smtp_password'] ?? '';
    $from = $settings['smtp_from_email'] ?: $username;

    if (!$host || !$username || !$password) {
        throw new RuntimeException('SMTP is not fully configured (host/username/password) in General Settings.');
    }

    // Belt-and-suspenders backstop: PHP's "Maximum execution time exceeded" fatal error is not
    // catchable, so this must stay comfortably above the per-step SMTP timeout below (15s) even
    // though a full conversation is ~10 round trips (connect/EHLO/STARTTLS/EHLO/AUTHx2/MAIL
    // FROM/RCPT TO/DATA/body/QUIT) that can add up past a tight cap without any single step
    // actually timing out.
    set_time_limit(45);

    $debugLog = [];
    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host = $host;
        $mail->Port = $port;
        $mail->SMTPAuth = true;
        $mail->Username = $username;
        $mail->Password = $password;
        // Timeout only bounds the initial connect; the wait for each command's response is
        // governed separately by SMTP::$Timelimit (default 300s) - both need to be set short so
        // a genuinely stuck step throws a catchable error well before the script-level backstop.
        $mail->Timeout = 15;
        $mail->getSMTPInstance()->Timelimit = 15;
        $mail->SMTPAutoTLS = false;
        $mail->SMTPSecure = $secure === 'none' ? '' : $secure;
        $mail->CharSet = 'UTF-8';
        $mail->SMTPDebug = 2;
        $mail->Debugoutput = function (string $line) use (&$debugLog) {
            $debugLog[] = trim($line);
        };

        $mail->setFrom($from, '');
        $mail->addAddress($to);
        $mail->Subject = $subject;
        $mail->isHTML(true);
        $mail->Body = $html;

        $mail->send();
    } catch (PHPMailerException $e) {
        $detail = $mail->ErrorInfo ?: $e->getMessage();
        if ($debugLog) {
            // Last few SMTP conversation lines pinpoint which step actually stalled/failed.
            $detail .= ' | SMTP trace: ' . implode(' :: ', array_slice($debugLog, -6));
        }
        throw new RuntimeException($detail);
    }
}
