// Keeps workspaces (orders, proposals, autopilot policy, audit log) across restarts.
// Off by default. Set REDIS_URL (Render Key Value) or DATA_FILE (a JSON file on disk).
// A free web service sleeps and restarts often; without this a restart empties every dashboard.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const FILE = process.env.DATA_FILE;
const REDIS = process.env.REDIS_URL;
const KEY = 'sellershield:state:v1';
export const PERSIST = REDIS ? 'redis' : FILE ? 'file' : 'off';

let client;
async function redis() {
  if (!client) {
    const { createClient } = await import('redis');
    client = createClient({ url: REDIS, socket: { reconnectStrategy: (n) => Math.min(n * 200, 3000) } });
    client.on('error', (e) => console.warn('state store:', e.message));
    await client.connect();
  }
  return client;
}

// Returns the saved state, or null. Never throws: the app starts empty if the store is down.
export async function loadState() {
  try {
    if (PERSIST === 'redis') { const s = await (await redis()).get(KEY); return s ? JSON.parse(s) : null; }
    if (PERSIST === 'file') return JSON.parse(await readFile(FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('could not load saved state:', e.message);
  }
  return null;
}

export async function saveState(json) {
  if (PERSIST === 'redis') await (await redis()).set(KEY, json);
  else if (PERSIST === 'file') { // write to a temp file, then swap: a crash never leaves half a file
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE + '.tmp', json);
    await rename(FILE + '.tmp', FILE);
  }
}

export async function closeState() { if (client) await client.quit().catch(() => {}); }
