// Extracts a clean 10-digit phone number to use as a username - members sometimes have more than
// one number on file (e.g. "9688502997 / 8072006482"), so this takes the first usable one and
// strips any country code/formatting, matching the convention already used for WhatsApp sends.
function firstPhoneDigits(phone) {
  if (!phone) return null;
  const candidates = String(phone).split(/[/,]|\s+(?:or|and)\s+/i);
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 10) return digits.slice(-10);
  }
  return null;
}

module.exports = { firstPhoneDigits };
