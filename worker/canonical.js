// One public address over HTTPS: plain-http requests, www.<canonical> and the *.workers.dev URL redirect to
// https://<canonical>, same path. localhost (wrangler dev) is served as it is.
export function canonicalRedirect(url, method, canonical) {
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (local) return null;
  const wrongHost = !!canonical && url.hostname !== canonical && (url.hostname === `www.${canonical}` || url.hostname.endsWith('.workers.dev'));
  if (!wrongHost && url.protocol === 'https:') return null;
  const target = new URL(url);
  target.protocol = 'https:';
  if (wrongHost) target.hostname = canonical;
  target.port = '';
  // 308 keeps the method and body for API writes; plain page loads get a cacheable 301.
  return Response.redirect(target.toString(), method === 'GET' || method === 'HEAD' ? 301 : 308);
}
