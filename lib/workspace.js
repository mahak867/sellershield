// Per-visitor workspaces: each browser gets its own demo state (orders, proposals, audit log,
// autopilot policy, demo disputes), so judges trying the hosted demo at the same time never
// reset or approve each other's items. Real PayPal sandbox data is still shared, as it really is.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const als = new AsyncLocalStorage();
const spaces = new Map();
const MAX_SPACES = 300;
export const SHARED = 'shared';

export function workspaceId() { return als.getStore() || SHARED; }

export function workspace() {
  const id = workspaceId();
  let w = spaces.get(id);
  if (!w) {
    w = {};
    spaces.set(id, w);
    if (spaces.size > MAX_SPACES) {
      const oldest = [...spaces.entries()].filter(([k]) => k !== SHARED).sort((a, b) => a[1]._last - b[1]._last)[0];
      if (oldest) spaces.delete(oldest[0]);
    }
  }
  w._last = Date.now();
  return w;
}

export function runIn(id, fn) { return als.run(id, fn); }

// Express middleware: read or set the workspace cookie, then run the request inside it.
export function workspaceMiddleware(req, res, next) {
  if (req.path.startsWith('/api/webhooks/')) return als.run(SHARED, next); // PayPal has no cookie
  // Agents calling the MCP endpoint have no cookie: they name the workspace with the session
  // header the server gave them, or with ?ws= copied from the seller's dashboard.
  const UUID = /^[0-9a-f-]{36}$/;
  const named = req.path === '/api/mcp' ? [req.headers['mcp-session-id'], req.query?.ws].find((x) => UUID.test(String(x || ''))) : null;
  if (named) return als.run(named, next);
  const m = /(?:^|;\s*)ss_ws=([0-9a-f-]{36})/.exec(req.headers.cookie || '');
  let id = m?.[1];
  if (!id) {
    id = randomUUID();
    res.setHeader('Set-Cookie', `ss_ws=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
  }
  als.run(id, next);
}

// Run fn inside every live workspace (used by the background scheduler).
export async function forEachWorkspace(fn) {
  for (const id of [...spaces.keys()]) await als.run(id, fn);
}
