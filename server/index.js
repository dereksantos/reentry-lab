// Reentry Lab local server: serves the app (Vite in dev, dist/ in prod) and the /api routes
// that connect it to the research agent and the notebook folder. Listens on localhost only.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { checkClaude, runAgent, cancelAgent, buildPrompt, appendThread, listThreads, readThread, ALLOWED_TOOLS } from './agent.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NB = path.join(ROOT, 'notebook');
const DIRS = { runs: path.join(NB, 'runs'), entries: path.join(NB, 'entries'), chats: path.join(NB, 'chats'), context: path.join(NB, '.context') };
const ensureDirs = () => { for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true }); };
ensureDirs();

const PORT = Number(process.env.PORT || 5317);
const HOST = '127.0.0.1';
const PROD = process.argv.includes('--prod');

// ---------- helpers ----------
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
function readBody(req, limit = 5e6) {
  return new Promise((resolve, reject) => {
    let size = 0, data = '';
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Request too large')); req.destroy(); } else data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
const safeName = (n) => path.basename(String(n)).replace(/[^a-zA-Z0-9._-]/g, '');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note';
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function listRuns() {
  return fs.readdirSync(DIRS.runs).filter((f) => f.endsWith('.json')).map((f) => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DIRS.runs, f), 'utf8'));
      return { file: f, label: d.label, createdBy: d.createdBy, createdAt: d.createdAt, note: d.note || '', params: d.params, summary: d.summary };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
function listEntries() {
  const out = [];
  for (const [dir, kind] of [[DIRS.entries, 'entry'], [DIRS.chats, 'chat']]) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const full = path.join(dir, f);
      const text = fs.readFileSync(full, 'utf8');
      const title = (text.match(/^#\s+(.+)$/m) || [, f.replace(/\.md$/, '')])[1];
      out.push({ name: f, kind, title, mtime: fs.statSync(full).mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------- live change notifications (Server-Sent Events) ----------
const clients = new Set();
function broadcast(type) {
  for (const res of clients) res.write(`event: ${type}\ndata: {}\n\n`);
}
const timers = {};
const debounced = (type) => { clearTimeout(timers[type]); timers[type] = setTimeout(() => broadcast(type), 250); };
fs.watch(DIRS.runs, () => debounced('runs'));
fs.watch(DIRS.entries, () => debounced('notebook'));
fs.watch(DIRS.chats, () => debounced('notebook'));

// ---------- API ----------
let claudeStatus = null;
async function api(req, res, url) {
  const p = url.pathname;
  try {
    ensureDirs(); // folders may have been removed while the app was running
    if (p === '/api/health') {
      if (!claudeStatus || url.searchParams.has('refresh')) claudeStatus = await checkClaude();
      return json(res, 200, { ok: true, root: ROOT, claude: claudeStatus, allowedTools: ALLOWED_TOOLS });
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (p === '/api/context' && req.method === 'POST') {
      const body = await readBody(req);
      fs.writeFileSync(path.join(DIRS.context, 'current.json'), JSON.stringify(body, null, 2));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/agent' && req.method === 'POST') {
      const body = await readBody(req);
      const message = String(body.message || '').trim();
      if (!message) return json(res, 400, { error: 'Message is empty.' });
      if (body.context) fs.writeFileSync(path.join(DIRS.context, 'current.json'), JSON.stringify(body.context.full || body.context, null, 2));
      const requestId = randomUUID();
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': requestId });
      const send = (ev) => res.write(JSON.stringify(ev) + '\n');
      send({ t: 'request', requestId });
      let sessionId = body.sessionId || null;
      let finalText = '';
      let pendingUser = message;
      const wrapped = (ev) => {
        if (ev.t === 'init' && ev.sessionId) {
          sessionId = ev.sessionId;
          if (pendingUser) { appendThread(ROOT, sessionId, { role: 'user', text: pendingUser }); pendingUser = null; }
        }
        if (ev.t === 'block' && finalText && !finalText.endsWith('\n\n')) finalText += '\n\n';
        if (ev.t === 'text') finalText += ev.delta;
        if (ev.t === 'done' && ev.result && !finalText) finalText = ev.result;
        send(ev);
      };
      res.on('close', () => { if (!res.writableEnded) cancelAgent(requestId); });
      await runAgent({ root: ROOT, requestId, prompt: buildPrompt(message, body.context?.brief), sessionId, model: body.model || null, send: wrapped });
      if (sessionId && finalText) appendThread(ROOT, sessionId, { role: 'assistant', text: finalText });
      res.end();
      return;
    }
    if (p === '/api/agent/cancel' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, { cancelled: cancelAgent(body.requestId) });
    }
    if (p === '/api/threads') return json(res, 200, listThreads(ROOT));
    if (p.startsWith('/api/threads/')) {
      const t = readThread(ROOT, p.slice('/api/threads/'.length));
      return t ? json(res, 200, t) : json(res, 404, { error: 'No such conversation.' });
    }
    if (p === '/api/runs' && req.method === 'GET') return json(res, 200, listRuns());
    if (p === '/api/runs' && req.method === 'POST') {
      const body = await readBody(req);
      const file = `${stamp()}-${slug(body.label || 'run')}.json`;
      const doc = { label: body.label || 'Run', createdBy: 'user', createdAt: new Date().toISOString(), note: body.note || '', model: body.model, params: body.params, summary: body.summary };
      fs.writeFileSync(path.join(DIRS.runs, file), JSON.stringify(doc, null, 2));
      return json(res, 200, { file });
    }
    if (p === '/api/notebook' && req.method === 'GET') return json(res, 200, listEntries());
    if (p === '/api/notebook' && req.method === 'POST') {
      const body = await readBody(req);
      const title = String(body.title || 'Note').trim();
      const file = `${stamp().slice(0, 10)}-${slug(title)}.md`;
      const full = path.join(DIRS.entries, file);
      const text = `# ${title}\n\n_Saved ${new Date().toLocaleString('en-US')} from Reentry Lab_\n\n${body.body || ''}\n`;
      if (fs.existsSync(full)) fs.appendFileSync(full, `\n---\n\n${body.body || ''}\n`); else fs.writeFileSync(full, text);
      return json(res, 200, { name: file });
    }
    if (p.startsWith('/api/notebook/')) {
      const name = safeName(decodeURIComponent(p.slice('/api/notebook/'.length)));
      for (const dir of [DIRS.entries, DIRS.chats]) {
        const full = path.join(dir, name);
        if (fs.existsSync(full)) return json(res, 200, { name, text: fs.readFileSync(full, 'utf8') });
      }
      return json(res, 404, { error: 'Not found.' });
    }
    return json(res, 404, { error: 'Unknown API route.' });
  } catch (e) {
    if (!res.headersSent) return json(res, 500, { error: e.message });
    try { res.end(); } catch {}
  }
}

// ---------- static / Vite ----------
let vite = null;
if (!PROD) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
function serveStatic(req, res, url) {
  const dist = path.join(ROOT, 'dist');
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// Only this app, loaded from this machine, may call the API. This blocks other websites open in your browser
// from posting to localhost (cross-site requests and DNS rebinding), since the API can start the agent.
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((h) => `http://${h}`));
function rejectForeign(req, res) {
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) return json(res, 403, { error: 'Unexpected Host header.' }), true;
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin.toLowerCase())) return json(res, 403, { error: 'Requests from other sites are not allowed.' }), true;
  if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'Expected application/json.' }), true;
  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) { if (rejectForeign(req, res)) return; return api(req, res, url); }
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) return json(res, 403, { error: 'Unexpected Host header.' });
  if (vite) return vite.middlewares(req, res);
  return serveStatic(req, res, url);
});
server.listen(PORT, HOST, () => {
  console.log(`\n  Reentry Lab running at http://localhost:${PORT}\n  Project folder: ${ROOT}\n`);
  checkClaude().then((s) => {
    claudeStatus = s;
    console.log(s.available ? `  Research agent: Claude Code ${s.version}` : `  Research agent unavailable: ${s.error}`);
  });
});
