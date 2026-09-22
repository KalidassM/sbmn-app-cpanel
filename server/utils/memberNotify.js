const db = require('../db');
const whatsapp = require('./whatsappClient');
const { portalUrl } = require('./appUrl');

async function appName() {
  const settings = await db.prepare('SELECT app_name FROM general_settings WHERE id = 1').get();
  return settings?.app_name || 'the Association';
}

// Appended to every outbound WhatsApp message as a consistent branded sign-off.
async function signOff() {
  return `~ *${await appName()}* ~`;
}

async function welcomeMessage(member) {
  const siteBit = member.site_no ? ` (Site No ${member.site_no})` : '';
  return `Welcome ${member.name}! You've been added as a member of ${await appName()}${siteBit}. We're glad to have you with us. Visit the portal: ${portalUrl()}\n\n${await signOff()}`;
}

// Sends a WhatsApp message to a member via the linked admin session (server/utils/whatsappClient.js).
// Never throws - a notification failure (WhatsApp not linked, no/bad phone on file, etc.) must not
// break the member create/status-change request that triggered it.
async function notifyMember(member, text) {
  try {
    if (!member?.phone) return;
    if (!whatsapp.isConnected()) return;
    await whatsapp.sendMessage(member.phone, text);
  } catch (err) {
    console.error('Member WhatsApp notification failed:', err.message);
  }
}

module.exports = { notifyMember, welcomeMessage, appName, signOff };
