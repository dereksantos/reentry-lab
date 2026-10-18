// Sign-in for the hosted version: GitHub and Google OAuth (authorization code + PKCE + state), and a
// localhost-only dev login. Sign-in only identifies who owns a notebook; model API keys never pass through here.
// Sessions are stateless cookies signed with HMAC-SHA256 (SESSION_SECRET).

const SESSION_COOKIE = 'rl_session';
const OAUTH_COOKIE = 'rl_oauth';
const SESSION_DAYS = 30;

const PROVIDERS = {
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user',
    clientId: (env) => env.GITHUB_CLIENT_ID,
    clientSecret: (env) => env.GITHUB_CLIENT_SECRET,
    async profile(accessToken) {
      const r = await fetch('https://api.github.com/user', {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'reentry-lab' }
      });
      if (!r.ok) throw new Error(`GitHub profile request failed (${r.status})`);
      const u = await r.json();
      return { uid: `github:${u.id}`, name: u.name || u.login };
    }
  },
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid profile',
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    clientSecret: (env) => env.GOOGLE_CLIENT_SECRET,
    async profile(accessToken) {
      const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
      if (!r.ok) throw new Error(`Google profile request failed (${r.status})`);
      const u = await r.json();
      return { uid: `google:${u.sub}`, name: u.name || 'Google user' };
    }
  }
};

export function enabledProviders(env, url) {
  return {
    github: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    dev: devLoginAllowed(env, url)
  };
}

// The dev login exists for `wrangler dev` only: it needs DEV_LOGIN=true (set in .dev.vars, never in wrangler.jsonc)
// and a localhost URL, so a deployed Worker refuses it even if the variable leaked into production.
function devLoginAllowed(env, url) {
  return env.DEV_LOGIN === 'true' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

// ---------- signing ----------
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmacKey(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET is missing or shorter than 32 characters.');
  return crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(env, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}
async function verify(env, token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  try {
    // crypto.subtle.verify compares in constant time.
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return payload.exp && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

// ---------- cookies ----------
function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
// Secure cookies are accepted on http://localhost by current browsers, so the same flags work in dev.
const cookie = (name, value, { maxAge, path = '/' }) =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

export async function getSession(request, env) {
  return verify(env, readCookie(request, SESSION_COOKIE));
}

async function startSession(env, user) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const token = await sign(env, { uid: user.uid, name: user.name, exp });
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400 });
}

const redirect = (location, cookies = []) => {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
};
const page = (status, message) => new Response(
  `<!doctype html><meta charset="utf-8"><title>Reentry Lab sign-in</title><p style="font:16px system-ui;margin:40px">${message} <a href="/">Back to Reentry Lab</a></p>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
);

async function pkceChallenge(verifier) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
}

// ---------- routes: /auth/login/:provider, /auth/callback/:provider, /auth/logout, /auth/dev ----------
export async function handleAuth(request, env, url) {
  const [, , action, name] = url.pathname.split('/');

  if (action === 'logout' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return page(403, 'Sign-out must come from this site.');
    return new Response(null, { status: 204, headers: { 'set-cookie': cookie(SESSION_COOKIE, '', { maxAge: 0 }) } });
  }

  if (action === 'dev') {
    if (!devLoginAllowed(env, url)) return page(404, 'Not found.');
    return redirect('/', [await startSession(env, { uid: 'dev:local', name: 'Local developer' })]);
  }

  const provider = PROVIDERS[name];
  if (!provider || !enabledProviders(env, url)[name]) return page(404, 'That sign-in option is not set up.');
  const redirectUri = `${url.origin}/auth/callback/${name}`;

  if (action === 'login') {
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const target = new URL(provider.authorize);
    target.search = new URLSearchParams({
      client_id: provider.clientId(env), redirect_uri: redirectUri, response_type: 'code', scope: provider.scope, state,
      code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256'
    }).toString();
    const flow = await sign(env, { state, verifier, provider: name, exp: Date.now() + 10 * 60e3 });
    return redirect(target.toString(), [cookie(OAUTH_COOKIE, flow, { maxAge: 600, path: '/auth' })]);
  }

  if (action === 'callback') {
    const clearFlow = cookie(OAUTH_COOKIE, '', { maxAge: 0, path: '/auth' });
    const flow = await verify(env, readCookie(request, OAUTH_COOKIE));
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error')) return page(400, 'Sign-in was cancelled.');
    if (!flow || flow.provider !== name || !code || url.searchParams.get('state') !== flow.state) {
      return page(400, 'Sign-in expired or did not match. Please try again.');
    }
    const tokenRes = await fetch(provider.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: provider.clientId(env), client_secret: provider.clientSecret(env), code, redirect_uri: redirectUri,
        grant_type: 'authorization_code', code_verifier: flow.verifier
      })
    });
    const tok = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tok.access_token) {
      console.log(JSON.stringify({ msg: 'oauth token exchange failed', provider: name, status: tokenRes.status, error: tok.error }));
      return page(502, 'The sign-in provider did not accept the request.');
    }
    const user = await provider.profile(tok.access_token);
    return redirect('/', [clearFlow, await startSession(env, user)]);
  }

  return page(404, 'Not found.');
}
