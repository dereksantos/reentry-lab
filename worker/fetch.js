// Page fetcher for the research agent's fetch_url tool (most sites don't allow cross-origin reads from the browser).
// Signed-in users only, rate limited by the caller. The response is opaque bytes, never HTML on this origin:
// the browser decodes it and strips markup itself, so fetched pages can't run script here.

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;
const TEXTY = /^(text\/|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|ld\+json))/i;

// Workers can't reach private networks, but refuse anything that isn't an ordinary public web URL anyway.
export function checkTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'That is not a valid URL.'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Only http and https URLs can be fetched.';
  if (u.username || u.password) return 'URLs with credentials are not allowed.';
  if (u.port && u.port !== '80' && u.port !== '443') return 'Only the standard web ports are allowed.';
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) return 'That host is not allowed.';
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return 'IP addresses are not allowed; use a host name.';
  return null;
}

export async function proxyFetch(target) {
  let url = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = checkTarget(url);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': 'ReentryLab/1.0 (research agent page fetch)', accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5' }
      });
    } catch (e) {
      return Response.json({ error: e.name === 'TimeoutError' ? 'The site took too long to respond.' : 'Could not reach that site.' }, { status: 502 });
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url).toString();
      await res.body?.cancel();
      continue;
    }
    const type = res.headers.get('content-type') || '';
    if (!TEXTY.test(type)) {
      await res.body?.cancel();
      const hint = /pdf/i.test(type) ? ' PDFs are not supported here; look for an HTML abstract or landing page instead.' : '';
      return Response.json({ error: `Unsupported content type "${type || 'unknown'}".${hint}`, status: res.status }, { status: 415 });
    }
    // Pass the body through, cut at MAX_BYTES, without buffering or decoding it here.
    let seen = 0;
    const limiter = new TransformStream({
      transform(chunk, controller) {
        if (seen >= MAX_BYTES) return;
        const room = MAX_BYTES - seen;
        controller.enqueue(chunk.byteLength > room ? chunk.slice(0, room) : chunk);
        seen += chunk.byteLength;
        if (seen >= MAX_BYTES) controller.terminate();
      }
    });
    return new Response(res.body.pipeThrough(limiter), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        'cache-control': 'no-store',
        'x-upstream-status': String(res.status),
        'x-upstream-content-type': type.slice(0, 200),
        'x-final-url': url
      }
    });
  }
  return Response.json({ error: 'Too many redirects.' }, { status: 502 });
}
