const db = require('../db');
const { sendMail, isConfigured } = require('./mailer');
const whatsapp = require('./whatsappClient');
const { signOff } = require('./memberNotify');

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Emails the association's contact address whenever a maintenance due gets a payment recorded
// against it (full or partial), by any path: manual entry, Razorpay from the portal, or the
// public pay-maintenance page. Never throws - a notification failure must not break the payment.
async function notifyAdminOfPayment(due) {
  try {
    if (!(await isConfigured())) return;
    const settings = await db.prepare('SELECT contact_email FROM general_settings WHERE id = 1').get();
    const to = settings?.contact_email;
    if (!to) return;

    const member = await db.prepare('SELECT name, site_no FROM members WHERE id = ?').get(due.member_id);
    const html = `
      <p>A maintenance payment was recorded.</p>
      <table cellpadding="4">
        <tr><td><strong>Member</strong></td><td>${member?.name || 'Unknown'} (Site No ${member?.site_no || '-'})</td></tr>
        <tr><td><strong>Month</strong></td><td>${MONTH_NAMES[due.month]} ${due.year}</td></tr>
        <tr><td><strong>Amount Paid</strong></td><td>₹${due.amount_paid} of ₹${due.amount_due}</td></tr>
        <tr><td><strong>Status</strong></td><td>${due.status}</td></tr>
        <tr><td><strong>Mode</strong></td><td>${due.payment_mode || '-'}</td></tr>
        <tr><td><strong>Reference</strong></td><td>${due.reference_no || '-'}</td></tr>
        <tr><td><strong>Paid Date</strong></td><td>${due.paid_date || '-'}</td></tr>
      </table>
    `;
    await sendMail({ to, subject: `Maintenance payment received - ${member?.name || 'member'}`, html });
  } catch (err) {
    console.error('Payment notification email failed:', err.message);
  }
}

// Sends a WhatsApp success confirmation to both the paying member and the association's own
// contact number, for one or more dues paid together (e.g. a combined multi-month payment gets
// one message, not one per month). Never throws - a notification failure must not break the
// payment. Silently does nothing if WhatsApp isn't configured, or if a phone number isn't on file.
async function notifyPaymentWhatsApp(dues) {
  try {
    if (!dues || !dues.length) return;
    if (!whatsapp.isConnected()) return;

    const member = await db.prepare('SELECT name, site_no, phone FROM members WHERE id = ?').get(dues[0].member_id);
    if (!member) return;

    const settings = await db.prepare('SELECT phone_number FROM general_settings WHERE id = 1').get();
    const totalPaid = dues.reduce((sum, d) => sum + Number(d.amount_paid), 0);
    const monthsText = dues.map((d) => `${MONTH_NAMES[d.month]} ${d.year}`).join(', ');
    const monthWord = dues.length > 1 ? `${dues.length} months` : '1 month';
    const signature = await signOff();

    if (member.phone) {
      const memberText = `Hi ${member.name}, your payment of ₹${totalPaid} for ${monthsText} has been received. Thank you!\n\n${signature}`;
      whatsapp.sendMessage(member.phone, memberText).catch((err) => console.error('Payment WhatsApp to member failed:', err.message));
    }

    if (settings?.phone_number) {
      const adminText = `Payment received: ₹${totalPaid} from ${member.name} (Site No ${member.site_no || '-'}) for ${monthsText} (${monthWord}).\n\n${signature}`;
      whatsapp.sendMessage(settings.phone_number, adminText).catch((err) => console.error('Payment WhatsApp to admin failed:', err.message));
    }
  } catch (err) {
    console.error('Payment WhatsApp notification failed:', err.message);
  }
}

// Sends a WhatsApp success confirmation to both the donor and the association's own contact
// number, once a donation is confirmed/verified as paid. Never throws. The donor's phone comes
// from the members table for a self-donation (member_id set), or donor_phone for a public
// well-wisher donation - whichever is on file.
async function notifyDonationWhatsApp(donation) {
  try {
    if (!donation) return;
    if (!whatsapp.isConnected()) return;

    let donorPhone = donation.donor_phone || null;
    let donorName = donation.donor_name || null;
    if (donation.member_id) {
      const member = await db.prepare('SELECT name, phone FROM members WHERE id = ?').get(donation.member_id);
      if (member) {
        donorPhone = donorPhone || member.phone;
        donorName = donorName || member.name;
      }
    }
    donorName = donorName || 'Donor';

    const settings = await db.prepare('SELECT phone_number FROM general_settings WHERE id = 1').get();
    const purposeText = donation.purpose ? ` for ${donation.purpose}` : '';
    const signature = await signOff();

    if (donorPhone) {
      const donorText = `Hi ${donorName}, thank you! Your donation of ₹${donation.amount}${purposeText} has been received.\n\n${signature}`;
      whatsapp.sendMessage(donorPhone, donorText).catch((err) => console.error('Donation WhatsApp to donor failed:', err.message));
    }

    if (settings?.phone_number) {
      const adminText = `Donation received: ₹${donation.amount} from ${donorName}${purposeText}.\n\n${signature}`;
      whatsapp.sendMessage(settings.phone_number, adminText).catch((err) => console.error('Donation WhatsApp to admin failed:', err.message));
    }
  } catch (err) {
    console.error('Donation WhatsApp notification failed:', err.message);
  }
}

module.exports = { notifyAdminOfPayment, notifyPaymentWhatsApp, notifyDonationWhatsApp };
