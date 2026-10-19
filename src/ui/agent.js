// Research chat. Local mode: talks to Claude Code (`claude -p`) through the local server and streams the reply.
// Hosted mode: runs the agent in this browser with the user's own model API key (src/agent/).
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { store, emit, on, persist, toast } from '../store.js';
import { escapeHtml } from '../format.js';
import { parseAssignment, setPath } from '../../sim/index.js';
import { loadHealth, isCloud, signedIn, api } from '../backend.js';
import { cloudAgentReady, runCloudAgent } from '../agent/index.js';
import { openSettings } from './settings.js';

let root, msgsEl, input, sendBtn, statusDot, statusText, historySel;
let messages = [];
let busy = null; // { requestId, controller }
let lastAsked = '';
let health = null;
let getContext = () => null;

const SUGGESTIONS = [
  'Why does peak heating happen at this altitude and not lower down?',
  'Find the entry corridor for this vehicle: which flight-path angles skip out and which exceed the g limit?',
  'How does this run compare with published flight data for the real mission it is modeled on?',
  'What would it take for magnetic braking to work for real? Find the current research.'
];

marked.use({
  renderer: {
    code(token) {
      const lang = (token.lang || '').trim();
      if (lang === 'sim-params') return `<div class="simparams" data-json="${escapeHtml(token.text)}"></div>`;
      return `<pre><code>${escapeHtml(token.text)}</code></pre>`;
    }
  }
});

function md(text) {
  const html = DOMPurify.sanitize(marked.parse(text || ''), { ADD_ATTR: ['target'] });
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  div.querySelectorAll('.simparams').forEach((el) => {
    let spec;
    try { spec = JSON.parse(el.dataset.json); } catch { el.replaceWith(Object.assign(document.createElement('pre'), { textContent: el.dataset.json })); return; }
    const label = spec.label || 'Suggested settings';
    const changes = Object.entries(spec).filter(([k]) => k !== 'label');
    el.className = 'apply-card';
    el.innerHTML = `<span class="t">${escapeHtml(label)}</span><ul>${changes.map(([k, v]) => `<li>${escapeHtml(k)} = ${escapeHtml(String(v))}</li>`).join('')}</ul><div><button class="btn primary small" type="button">Apply to simulator</button></div>`;
    el.querySelector('button').addEventListener('click', () => applySpec(label, changes));
  });
  return div;
}

function applySpec(label, changes) {
  try {
    const parsed = changes.map(([k, v]) => parseAssignment(`${k}=${v}`));
    emit('pin-current', 'Before: ' + label);
    for (const p of parsed) setPath(store.params, p.path, p.value);
    emit('params-external');
    toast(`Applied “${label}”. Your previous run is pinned for comparison.`);
  } catch (e) {
    toast(`Couldn't apply: ${e.message}`, 4000);
  }
}

export function buildAgent(el, contextFn) {
  root = el;
  getContext = contextFn;
  root.innerHTML = `
    <div class="agent">
      <div class="agent-head">
        <span class="status-dot" id="agentDot"></span>
        <span class="st" id="agentStatus">Checking for Claude Code…</span>
        <select id="historySel" aria-label="Conversations"><option value="">History</option></select>
        ${isCloud() ? '<button class="btn small" id="agentSettings" type="button">Model</button>' : `<select id="modelSel" aria-label="Model">
          <option value="">Default model</option><option value="opus">Opus</option><option value="sonnet">Sonnet</option><option value="haiku">Haiku</option>
        </select>`}
        <button class="btn small" id="newChat" type="button">New</button>
      </div>
      <div class="msgs" id="msgs"></div>
      <div class="composer">
        <textarea id="ask" placeholder="Ask about this run, or ask for research…" rows="3"></textarea>
        <div class="row">
          <label class="toggle"><input type="checkbox" id="ctxToggle"> Share the current run</label>
          <button class="btn primary" id="sendBtn" type="button">Send</button>
        </div>
      </div>
    </div>`;
  msgsEl = root.querySelector('#msgs');
  input = root.querySelector('#ask');
  sendBtn = root.querySelector('#sendBtn');
  statusDot = root.querySelector('#agentDot');
  statusText = root.querySelector('#agentStatus');
  historySel = root.querySelector('#historySel');
  keepQuestionAcrossUpdate();
  const modelSel = root.querySelector('#modelSel');
  if (modelSel) {
    modelSel.value = store.model;
    modelSel.addEventListener('change', () => { store.model = modelSel.value; persist(); });
  }
  root.querySelector('#agentSettings')?.addEventListener('click', openSettings);
  on('agent-settings', () => checkHealth());
  const ctx = root.querySelector('#ctxToggle');
  ctx.checked = store.includeContext;
  ctx.addEventListener('change', () => { store.includeContext = ctx.checked; persist(); });
  root.querySelector('#newChat').addEventListener('click', () => { if (busy) return; store.sessionId = null; persist(); messages = []; render(); input.focus(); });
  historySel.addEventListener('change', () => { if (historySel.value) openThread(historySel.value); historySel.value = ''; });
  sendBtn.addEventListener('click', () => (busy ? stop() : send(input.value)));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) send(input.value); }
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(180, input.scrollHeight) + 'px'; });
  checkHealth();
  loadHistory();
  if (store.sessionId) openThread(store.sessionId, true); else render();
}

async function checkHealth(refresh) {
  if (isCloud()) {
    const ready = cloudAgentReady();
    health = { claude: { available: ready.ok, error: ready.reason } };
    statusDot.dataset.s = ready.ok ? 'ok' : 'warn';
    statusText.textContent = ready.ok ? ready.label : 'Add a model API key';
    statusText.title = ready.ok ? 'The agent runs in this browser and calls the model provider directly with your key.' : ready.reason;
    return render();
  }
  health = await loadHealth(refresh);
  if (!health.claude) health = { claude: { available: false, error: health.error || 'The local server is not responding.' } };
  const ok = health.claude?.available;
  statusDot.dataset.s = ok ? 'ok' : 'crit';
  statusText.textContent = ok ? `Claude Code ${health.claude.version.replace(/\s*\(.*\)/, '')}` : 'Research agent unavailable';
  statusText.title = ok ? 'Answers come from Claude Code running headless in this project folder.' : health.claude?.error || '';
  render();
}

async function loadHistory() {
  historySel.hidden = !signedIn();
  if (!signedIn()) return;
  try {
    const list = await (await fetch('/api/threads')).json();
    historySel.innerHTML = '<option value="">History</option>' + list.slice(0, 30).map((t) => `<option value="${t.sessionId}">${escapeHtml(t.title || 'Untitled')}</option>`).join('');
  } catch {}
}

async function openThread(id, quiet) {
  if (!signedIn()) { store.sessionId = null; persist(); return render(); }
  try {
    const t = await (await fetch('/api/threads/' + id)).json();
    if (!t || !t.messages) throw new Error();
    messages = t.messages.map((m) => ({ role: m.role, text: m.text, steps: [] }));
    store.sessionId = id; persist();
    render();
  } catch {
    if (!quiet) toast('That conversation could not be opened.');
    store.sessionId = null; persist();
    messages = []; render();
  }
}

function render() {
  msgsEl.innerHTML = '';
  if (health && !health.claude?.available && isCloud()) {
    const s = document.createElement('div');
    s.className = 'setup';
    s.innerHTML = `<b>Bring your own model to start researching.</b>
      <span>${escapeHtml(health.claude.error || '')} Anthropic (Claude), OpenAI, xAI (Grok), Google Gemini and OpenRouter work. Your key stays in this browser and goes only to that provider.</span>
      <div><button class="btn small primary" type="button">Open settings</button></div>`;
    s.querySelector('button').addEventListener('click', openSettings);
    msgsEl.appendChild(s);
  } else if (health && !health.claude?.available) {
    const s = document.createElement('div');
    s.className = 'setup';
    s.innerHTML = `<b>The research agent needs Claude Code on this computer.</b>
      <span>${escapeHtml(health.claude?.error || '')}</span>
      <span>Install Claude Code and run <code>claude</code> once in a terminal to log in. If it lives somewhere unusual, start the app with <code>CLAUDE_BIN=/path/to/claude npm run dev</code>.</span>
      <div><button class="btn small" type="button">Check again</button></div>`;
    s.querySelector('button').addEventListener('click', () => checkHealth(true));
    msgsEl.appendChild(s);
  }
  if (!messages.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.innerHTML = `<h3>Research together</h3><span>Ask about what you see. The agent gets the run you have loaded, can run the simulator itself, search NASA reports and papers, and keep notes in the notebook.</span><div class="suggest">${SUGGESTIONS.map((s) => `<button type="button">${escapeHtml(s)}</button>`).join('')}</div>`;
    e.querySelectorAll('.suggest button').forEach((b) => b.addEventListener('click', () => { input.value = b.textContent; input.focus(); }));
    msgsEl.appendChild(e);
  }
  for (const m of messages) msgsEl.appendChild(renderMsg(m));
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function renderMsg(m) {
  const el = document.createElement('div');
  el.className = `msg ${m.role}`;
  el.innerHTML = `<span class="who">${m.role === 'user' ? 'You' : 'Research agent'}</span>`;
  if (m.steps && m.steps.length) {
    const steps = document.createElement('div');
    steps.className = 'steps';
    const items = m.steps.map((s) => `<div class="step ${s.isError ? 'err' : ''}" title="${escapeHtml(s.text)}"><b>${s.kind}</b><span>${escapeHtml(s.text)}</span></div>`);
    if (items.length > 4 && !m.streaming) steps.innerHTML = `<details><summary>${items.length} steps</summary>${items.join('')}</details>`;
    else steps.innerHTML = items.join('');
    el.appendChild(steps);
  }
  const body = document.createElement('div');
  body.className = 'body';
  if (m.role === 'user') body.textContent = m.text;
  else body.appendChild(md(m.text));
  if (m.streaming) body.classList.add('cursor-blink');
  if (m.role === 'assistant' && m.status && !m.text) body.innerHTML = `<span style="color:var(--muted)">${escapeHtml(m.status)}</span>`;
  el.appendChild(body);
  if (m.role === 'assistant' && !m.streaming && m.text) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    const bits = [];
    if (m.durationMs) bits.push(`${Math.round(m.durationMs / 1000)} s`);
    if (m.costUsd) bits.push(`est. $${m.costUsd.toFixed(2)}`);
    if (m.usage) bits.push(`${fmtTokens(m.usage.input)} in · ${fmtTokens(m.usage.output)} out tokens`);
    if (m.servedBy) bits.push(`answered by ${m.servedBy}`);
    meta.innerHTML = `<span>${bits.join(' · ')}</span><button type="button" data-a="save">Save to notebook</button><button type="button" data-a="copy">Copy</button>`;
    meta.querySelector('[data-a=save]').addEventListener('click', () => saveToNotebook(m));
    meta.querySelector('[data-a=copy]').addEventListener('click', () => navigator.clipboard?.writeText(m.text).then(() => toast('Copied')));
    el.appendChild(meta);
  }
  if (m.error) {
    const e = document.createElement('div');
    e.className = 'setup';
    e.textContent = m.error;
    el.appendChild(e);
  }
  return el;
}

const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

async function saveToNotebook(m) {
  if (!signedIn()) return toast('Sign in (Settings) to keep a notebook.');
  const i = messages.indexOf(m);
  const q = messages.slice(0, i).reverse().find((x) => x.role === 'user');
  const title = (q ? q.text : 'Research note').split('\n')[0].slice(0, 80);
  const body = (q ? `**Question:** ${q.text}\n\n` : '') + m.text;
  try {
    await api('/api/notebook', { method: 'POST', body: { title, body } });
    emit('remote-change', 'notebook');
    toast('Saved to the notebook');
  } catch (e) {
    toast(`Saving failed: ${e.message}`);
  }
}

// After a deploy, a tab opened earlier still runs the old build, and the pieces it loads on first use (the model
// adapters) are gone from the server. Vite reports that as vite:preloadError: reload once to get the new build,
// and put the question back in the box so nothing typed is lost.
function keepQuestionAcrossUpdate() {
  try {
    const draft = sessionStorage.getItem('rl-draft');
    if (draft) {
      sessionStorage.removeItem('rl-draft');
      input.value = draft;
      toast('Reentry Lab was updated, so the page reloaded. Your question is back in the box.', 5000);
    }
  } catch {}
  window.addEventListener('vite:preloadError', (e) => {
    try {
      // Already reloaded for this a moment ago: let the error show instead of looping.
      if (Date.now() - Number(sessionStorage.getItem('rl-reloaded') || 0) < 60_000) return;
      sessionStorage.setItem('rl-reloaded', String(Date.now()));
      const draft = input.value.trim() || lastAsked;
      if (draft) sessionStorage.setItem('rl-draft', draft);
    } catch { return; }
    e.preventDefault();
    location.reload();
  });
}

async function send(text) {
  text = (text || '').trim();
  if (!text || busy) return;
  if (isCloud()) {
    const ready = cloudAgentReady();
    if (!ready.ok) { toast(ready.reason, 4000); checkHealth(); openSettings(); return; }
  }
  lastAsked = text;
  input.value = '';
  input.style.height = '';
  const userMsg = { role: 'user', text };
  const history = messages.filter((m) => !m.streaming && m.text && !m.error).map((m) => ({ role: m.role, text: m.text }));
  const reply = { role: 'assistant', text: '', steps: [], streaming: true, status: isCloud() ? 'Starting…' : 'Starting Claude Code…' };
  messages.push(userMsg, reply);
  render();
  const controller = new AbortController();
  busy = { controller, requestId: null };
  sendBtn.textContent = 'Stop';
  let lastPaint = 0;
  const paint = (force) => {
    const now = performance.now();
    if (!force && now - lastPaint < 80) return;
    lastPaint = now;
    const last = msgsEl.lastElementChild;
    const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80;
    if (last) last.replaceWith(renderMsg(reply)); else msgsEl.appendChild(renderMsg(reply));
    if (nearBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
  };
  try {
    const ctx = store.includeContext ? getContext() : null;
    if (isCloud()) {
      await runCloudAgent({
        message: text, context: ctx?.brief || null, history, sessionId: store.sessionId, signal: controller.signal, getContext,
        send: (ev) => { handle(ev, reply); paint(ev.t === 'done' || ev.t === 'tool'); }
      });
      return;
    }
    const res = await fetch('/api/agent', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ message: text, sessionId: store.sessionId, model: store.model || null, context: ctx })
    });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Server error ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        handle(ev, reply);
        paint(ev.t === 'done' || ev.t === 'tool');
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') reply.error = e.message;
  } finally {
    reply.streaming = false;
    reply.status = '';
    busy = null;
    sendBtn.textContent = 'Send';
    paint(true);
    loadHistory();
  }
}

function handle(ev, reply) {
  switch (ev.t) {
    case 'request': busy && (busy.requestId = ev.requestId); break;
    case 'init':
      if (ev.sessionId) { store.sessionId = ev.sessionId; persist(); }
      reply.status = 'Thinking…';
      break;
    case 'block': if (reply.text && !reply.text.endsWith('\n\n')) reply.text += '\n\n'; break;
    case 'text': reply.text += ev.delta; break;
    case 'tool': reply.steps.push({ id: ev.id, kind: { search: 'search', read: 'read', sim: 'sim', file: 'file', write: 'note' }[ev.kind] || 'tool', text: ev.text }); reply.status = ev.text; break;
    case 'tool_result': { const s = reply.steps.find((x) => x.id === ev.id); if (s && ev.isError) { s.isError = true; s.text += ' (failed)'; } break; }
    case 'status': reply.status = ev.text; break;
    case 'done':
      if (ev.sessionId) { store.sessionId = ev.sessionId; persist(); }
      if (!reply.text && ev.result && !ev.isError) reply.text = ev.result;
      if (ev.isError && !reply.text) reply.error = ev.result || 'The agent stopped with an error.';
      if (ev.cancelled && !reply.text) reply.text = '_Stopped._';
      reply.costUsd = ev.costUsd; reply.durationMs = ev.durationMs; reply.usage = ev.usage; reply.servedBy = ev.servedBy;
      if (ev.denials && ev.denials.length) reply.steps.push({ kind: 'note', text: `Blocked by permissions: ${[...new Set(ev.denials)].join(', ')}`, isError: true });
      break;
    case 'error': reply.error = ev.message; break;
  }
}

async function stop() {
  if (!busy) return;
  const { requestId, controller } = busy;
  if (isCloud()) return controller.abort();
  if (requestId) await fetch('/api/agent/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId }) }).catch(() => {});
  setTimeout(() => controller.abort(), 1500);
}
