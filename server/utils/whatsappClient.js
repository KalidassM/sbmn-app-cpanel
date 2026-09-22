// Sends WhatsApp messages via the official WhatsApp Business Cloud API (Meta Graph API), instead
// of automating a real WhatsApp Web session (Baileys) - deliberate choice for this cPanel-hosted
// fork so the app has no requirement on a persistent, long-lived Node process or local session
// state, which shared/budget cPanel hosting cannot reliably guarantee.
//
// IMPORTANT - Meta's 24-hour session window: freeform text messages (what sendMessage() below
// sends) only deliver if the recipient has messaged this WhatsApp Business number within the last
// 24 hours. Business-initiated messages outside that window - monthly dues reminders, the
// welcome message on signup, payment/donation confirmations, forgot-password codes - are
// considered "business-initiated conversations" by Meta and require a pre-approved Message
// Template (created and approved in Meta Business Manager) instead of freeform text. Use
// sendTemplateMessage() for those once the templates are approved; sendMessage() is left in place
// for admin "test message" sends and for any flow where the member has just messaged in.
const db = require('../db');
const { sendMail, isConfigured: isEmailConfigured } = require('./mailer');
const { baseUrl } = require('./appUrl');

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
let disconnectEmailSent = false;

function isConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

// Kept for interface parity with the rest of the app (General Settings status pill, /api/whatsapp
// routes) - there's no live session to track here, just whether credentials are present.
function getStatus() {
  return isConfigured() ? 'connected' : 'disconnected';
}

function isConnected() {
  return isConfigured();
}

// Emails the association's contact address once, the first time a send fails because credentials
// are missing/invalid - mirrors the old Baileys disconnect alert so the admin still finds out if
// reminders/notifications quietly stop going out, without spamming an email per failed send.
async function notifyAdminOfMisconfig(reason) {
  if (disconnectEmailSent) return;
  disconnectEmailSent = true;
  try {
    if (!(await isEmailConfigured())) return;
    const settings = await db.prepare('SELECT contact_email, app_name FROM general_settings WHERE id = 1').get();
    const to = settings?.contact_email;
    if (!to) return;
    const appName = settings?.app_name || 'the Association';
    await sendMail({
      to,
      subject: `${appName} - WhatsApp sending failed in ${baseUrl()}`,
      html: `<p>A WhatsApp message could not be sent from the ${appName} portal: ${reason}.</p>
             <p>Check the WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID settings on the server.</p>`,
    });
  } catch (err) {
    console.error('WhatsApp misconfig email failed:', err.message);
  }
}

function toWhatsAppNumbers(phone) {
  if (!phone) return [];
  // Some members have more than one number on file (e.g. "9688502997 / 8072006482") -
  // send to every one that looks valid instead of concatenating all the digits together
  const candidates = String(phone).split(/[/,]|\s+(?:or|and)\s+/i);
  const numbers = new Set();
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 10) {
      numbers.add(digits.length === 10 ? `91${digits}` : digits);
    }
  }
  return [...numbers];
}

async function callGraphApi(payload) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WhatsApp API error (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

// Freeform text message - only deliverable within Meta's 24-hour customer-service window (see
// note at top of file). Used for the admin "test message" button.
async function sendMessage(phone, text) {
  if (!isConfigured()) {
    await notifyAdminOfMisconfig('WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured');
    throw new Error('WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.');
  }
  const numbers = toWhatsAppNumbers(phone);
  if (!numbers.length) throw new Error('No valid phone number on file');
  for (const to of numbers) {
    await callGraphApi({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text, preview_url: false },
    });
  }
}

// Pre-approved Message Template send, required for business-initiated messages outside the
// 24-hour window. `params` fills the template's {{1}}, {{2}}... body placeholders in order.
async function sendTemplateMessage(phone, templateName, languageCode, params = []) {
  if (!isConfigured()) {
    await notifyAdminOfMisconfig('WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured');
    throw new Error('WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.');
  }
  const numbers = toWhatsAppNumbers(phone);
  if (!numbers.length) throw new Error('No valid phone number on file');
  for (const to of numbers) {
    await callGraphApi({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: params.length
          ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }]
          : [],
      },
    });
  }
}

module.exports = { getStatus, isConnected, isConfigured, sendMessage, sendTemplateMessage };
