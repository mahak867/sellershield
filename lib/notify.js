// Outbound alerts: SellerShield posts a small JSON event to a webhook the seller chose, so a
// Zap (Zapier "Catch Hook") can turn it into an email, a Slack or WhatsApp message, a sheet row.
// On a public demo the server must not fetch arbitrary URLs, so only Zapier hook URLs are
// accepted. Self-hosters can allow more hosts with NOTIFY_HOSTS (comma-separated hostnames).
const EXTRA = (process.env.NOTIFY_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);

// Returns the normalised URL, or null if it is not an allowed webhook address.
export function allowedWebhook(u) {
  try {
    const x = new URL(String(u));
    const extra = EXTRA.includes(x.hostname);
    if (x.hostname !== 'hooks.zapier.com' && !extra) return null;
    if (x.protocol !== 'https:' && !(extra && x.protocol === 'http:')) return null;
    if (x.username || x.password) return null;
    return x.toString();
  } catch { return null; }
}

// Never throws: an alert that fails must not break the agent.
export async function notify(url, event) {
  if (!url) return false;
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'sellershield', at: new Date().toISOString(), ...event }),
      signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    return r.ok;
  } catch { return false; }
}
