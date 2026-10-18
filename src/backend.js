// Which backend the app is talking to. Both serve the same /api routes for runs, notes and chats.
//   local: server/index.js on your machine; the research agent is Claude Code (`claude -p`) run by the server.
//   cloud: worker/index.js on Cloudflare; the research agent runs in this browser with your own model API key,
//          and the notebook lives in your account (sign-in required to save anything).

let health = null;

export async function loadHealth(refresh) {
  try {
    const r = await fetch('/api/health' + (refresh ? '?refresh' : ''));
    health = await r.json();
  } catch {
    health = { ok: false, error: 'The server is not responding.' };
  }
  return health;
}

export const getHealth = () => health;
export const isCloud = () => health?.mode === 'cloud';
export const signedIn = () => !isCloud() || !!health?.user;

export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method,
    headers: body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Server error ${r.status}`), { status: r.status });
  return data;
}
