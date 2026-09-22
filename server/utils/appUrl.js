// Resolves the public URL of this deployment - set APP_PUBLIC_URL to the cPanel domain in
// production; falls back to localhost for local dev.
function baseUrl() {
  if (process.env.APP_PUBLIC_URL) return process.env.APP_PUBLIC_URL.replace(/\/$/, '');
  return 'http://localhost:3000';
}

function portalUrl() {
  return `${baseUrl()}/portal`;
}

module.exports = { baseUrl, portalUrl };
