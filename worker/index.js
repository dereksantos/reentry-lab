// Reentry Lab on Cloudflare Workers. Static assets (the built app in dist/) are served by the asset binding;
// this Worker handles only /auth/* (sign-in) and /api/* (per-user notebook storage and the page fetcher).
// The research agent runs in the browser with the user's own model API key, which never reaches this Worker.

import { Lab } from './lab.js';
import { handleAuth, getSession, enabledProviders } from './auth.js';
import { proxyFetch } from './fetch.js';
import { canonicalRedirect } from './canonical.js';

export { Lab };

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cache-control': 'no-store'
};
const json = (status, body, extra = {}) => Response.json(body, { status, headers: { ...SECURITY_HEADERS, ...extra } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const moved = canonicalRedirect(url, request.method, env.CANONICAL_HOST);
    if (moved) return moved;
    try {
      if (url.pathname.startsWith('/auth/')) {
        const { success } = await env.AUTH_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
        if (!success) return json(429, { error: 'Too many sign-in attempts. Wait a minute and try again.' });
        return await handleAuth(request, env, url);
      }
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      // The app is one page. OpenRouter's sign-in returns to this path (OPENROUTER_CALLBACK_PATH in
      // src/agent/providers.js), so serve the app there too; any other unknown path gets 404.html.
      if (url.pathname === '/openrouter/callback') return env.ASSETS.fetch(new Request(new URL('/', url), request));
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(JSON.stringify({ msg: 'unhandled error', path: url.pathname, error: String(e?.stack || e) }));
      return json(500, { error: 'Something went wrong on the server.' });
    }
  }
};

async function readJson(request, limit = 1_000_000) {
  if (Number(request.headers.get('content-length') || 0) > limit) throw Object.assign(new Error('Request too large.'), { status: 413 });
  const text = await request.text();
  if (text.length > limit) throw Object.assign(new Error('Request too large.'), { status: 413 });
  try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

async function api(request, env, url) {
  const p = url.pathname;
  const write = request.method !== 'GET' && request.method !== 'HEAD';
  // Writes must come from this site's own pages, as JSON (blocks cross-site form posts; cookies are SameSite=Lax too).
  if (write) {
    if (request.headers.get('origin') !== url.origin) return json(403, { error: 'Requests from other sites are not allowed.' });
    if (!String(request.headers.get('content-type') || '').startsWith('application/json')) return json(415, { error: 'Expected application/json.' });
  }

  const session = await getSession(request, env);

  if (p === '/api/health') {
    return json(200, {
      ok: true, mode: 'cloud',
      user: session ? { name: session.name, id: session.uid.split(':')[0] } : null,
      signIn: enabledProviders(env, url),
      supportUrl: env.SUPPORT_URL || null,
      sourceUrl: env.SOURCE_URL || null
    });
  }

  if (!session) return json(401, { error: 'Sign in to use the notebook and the research agent.' });
  const { success } = await env.API_LIMIT.limit({ key: session.uid });
  if (!success) return json(429, { error: 'Too many requests. Wait a minute and try again.' });

  if (p === '/api/fetch' && request.method === 'POST') {
    const { success: ok } = await env.FETCH_LIMIT.limit({ key: session.uid });
    if (!ok) return json(429, { error: 'Page fetch limit reached. Wait a minute and try again.' });
    const body = await readJson(request, 10_000);
    return proxyFetch(String(body.url || ''));
  }

  const lab = env.LAB.getByName(session.uid);
  const call = async (method, ...args) => {
    const r = await lab.call(method, ...args);
    return json(r.status, r.body);
  };

  try {
    if (p === '/api/runs' && request.method === 'GET') return await call('listRuns');
    if (p === '/api/runs' && request.method === 'POST') return await call('saveRun', await readJson(request));
    if (p === '/api/notebook' && request.method === 'GET') return await call('listEntries');
    if (p === '/api/notebook' && request.method === 'POST') return await call('saveNote', await readJson(request));
    if (p.startsWith('/api/notebook/') && request.method === 'GET') return await call('readEntry', decodeURIComponent(p.slice('/api/notebook/'.length)));
    if (p === '/api/threads' && request.method === 'GET') return await call('listThreads');
    const thread = p.match(/^\/api\/threads\/([a-zA-Z0-9-]{1,64})(\/messages)?$/);
    if (thread && !thread[2] && request.method === 'GET') return await call('readThread', thread[1]);
    if (thread && thread[2] && request.method === 'POST') return await call('appendThread', thread[1], await readJson(request));
    if (p === '/api/account/export' && request.method === 'GET') {
      const r = await lab.call('exportAll');
      return json(r.status, r.body, { 'content-disposition': 'attachment; filename="reentry-lab-export.json"' });
    }
    if (p === '/api/account' && request.method === 'DELETE') {
      const r = await lab.call('deleteAll');
      return json(r.status, r.body, { 'set-cookie': 'rl_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' });
    }
  } catch (e) {
    if (e.status) return json(e.status, { error: e.message });
    throw e;
  }
  return json(404, { error: 'Unknown API route.' });
}
