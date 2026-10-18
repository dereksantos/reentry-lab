// Bridge between the app and Claude Code running headless (`claude -p`).
// Each question spawns one `claude -p` process in the project folder. Conversation continuity comes from
// `--resume <session_id>`. Output is read as stream-json and normalized into small events for the browser.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

// What the research agent may do without asking. Everything else is denied (dontAsk mode).
export const ALLOWED_TOOLS = [
  'Read', 'Glob', 'Grep',
  'WebSearch', 'WebFetch',
  'Bash(node sim/cli.js *)',
  'Edit(./notebook/**)', 'Write(./notebook/**)'
];

const running = new Map(); // requestId -> child process

export function checkClaude() {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const child = spawn(CLAUDE_BIN, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (d) => (out += d));
      child.on('error', (e) => finish({ available: false, error: e.code === 'ENOENT' ? `"${CLAUDE_BIN}" was not found on PATH` : e.message }));
      child.on('close', (code) => finish(code === 0 ? { available: true, version: out.trim() } : { available: false, error: `claude --version exited with ${code}` }));
      setTimeout(() => { child.kill(); finish({ available: false, error: 'claude --version timed out' }); }, 8000);
    } catch (e) {
      finish({ available: false, error: e.message });
    }
  });
}

function rel(root, p) {
  if (!p) return '';
  try { return path.relative(root, p) || p; } catch { return p; }
}

function describeTool(root, name, input = {}) {
  switch (name) {
    case 'WebSearch': return { kind: 'search', text: `Searching the web for “${input.query || ''}”` };
    case 'WebFetch': {
      let host = input.url || '';
      try { host = new URL(input.url).host; } catch {}
      return { kind: 'read', text: `Reading ${host}`, url: input.url };
    }
    case 'Bash': return { kind: 'sim', text: `Running ${String(input.command || '').replace(/^node sim\/cli\.js/, 'simulator:')}` };
    case 'Read': return { kind: 'file', text: `Reading ${rel(root, input.file_path)}` };
    case 'Write': case 'Edit': return { kind: 'write', text: `Writing ${rel(root, input.file_path)}` };
    case 'Glob': case 'Grep': return { kind: 'file', text: `Looking through project files` };
    default: return { kind: 'other', text: name };
  }
}

export function buildPrompt(message, context) {
  if (!context) return message;
  return `<app_context>\nWhat the user currently has loaded in Reentry Lab (full detail in notebook/.context/current.json):\n${JSON.stringify(context)}\n</app_context>\n\n${message}`;
}

/**
 * Run one agent turn. `send(event)` receives normalized events.
 * Returns a promise that resolves when the process exits.
 */
export function runAgent({ root, requestId, prompt, sessionId, model, send }) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--append-system-prompt-file', path.join(root, 'agent', 'system.md'),
    '--permission-mode', 'dontAsk',
    '--allowedTools', ALLOWED_TOOLS.join(',')
  ];
  if (model) args.push('--model', model);
  if (sessionId) args.push('--resume', sessionId);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(CLAUDE_BIN, args, { cwd: root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      send({ t: 'error', message: `Could not start Claude Code: ${e.message}` });
      return resolve();
    }
    running.set(requestId, child);
    let buf = '';
    let stderr = '';
    let gotResult = false;
    const toolNames = new Map();

    child.on('error', (e) => {
      send({ t: 'error', message: e.code === 'ENOENT' ? `Claude Code ("${CLAUDE_BIN}") was not found. Install it and run "claude" once to log in.` : e.message });
    });
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        handle(m);
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code, signal) => {
      running.delete(requestId);
      if (!gotResult) {
        if (signal === 'SIGINT' || signal === 'SIGTERM') send({ t: 'done', cancelled: true });
        else send({ t: 'error', message: (stderr.trim().split('\n').slice(-6).join('\n')) || `Claude Code exited with code ${code}` });
      }
      resolve();
    });

    function handle(m) {
      const topLevel = !m.parent_tool_use_id;
      if (m.type === 'system' && m.subtype === 'init') {
        send({ t: 'init', sessionId: m.session_id, model: m.model });
      } else if (m.type === 'system' && m.subtype === 'api_retry') {
        send({ t: 'status', text: `Retrying the API (attempt ${m.attempt} of ${m.max_retries})` });
      } else if (m.type === 'stream_event' && topLevel) {
        const ev = m.event || {};
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') send({ t: 'block' });
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') send({ t: 'text', delta: ev.delta.text });
      } else if (m.type === 'assistant') {
        for (const b of m.message?.content || []) {
          if (b.type === 'tool_use') {
            toolNames.set(b.id, b.name);
            send({ t: 'tool', id: b.id, name: b.name, nested: !topLevel, ...describeTool(root, b.name, b.input) });
          }
        }
      } else if (m.type === 'user') {
        for (const b of m.message?.content || []) {
          if (b.type === 'tool_result') {
            let preview = '';
            if (typeof b.content === 'string') preview = b.content;
            else if (Array.isArray(b.content)) preview = b.content.map((c) => c.text || '').join('\n');
            send({ t: 'tool_result', id: b.tool_use_id, name: toolNames.get(b.tool_use_id), isError: !!b.is_error, preview: preview.slice(0, 400) });
          }
        }
      } else if (m.type === 'result') {
        gotResult = true;
        send({
          t: 'done', sessionId: m.session_id, isError: !!m.is_error, subtype: m.subtype, result: m.result,
          costUsd: m.total_cost_usd, durationMs: m.duration_ms, turns: m.num_turns,
          denials: (m.permission_denials || []).map((d) => d.tool_name)
        });
      }
    }

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export function cancelAgent(requestId) {
  const child = running.get(requestId);
  if (!child) return false;
  child.kill('SIGINT');
  setTimeout(() => { if (running.has(requestId)) child.kill('SIGTERM'); }, 4000);
  return true;
}

// ---------- chat threads (kept so the UI can reopen past conversations) ----------
export function threadPaths(root, sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9-]/g, '');
  return {
    json: path.join(root, 'notebook', '.context', 'threads', `${safe}.json`),
    md: path.join(root, 'notebook', 'chats', `${safe}.md`)
  };
}

export function appendThread(root, sessionId, entry) {
  const p = threadPaths(root, sessionId);
  fs.mkdirSync(path.dirname(p.json), { recursive: true });
  fs.mkdirSync(path.dirname(p.md), { recursive: true });
  let doc = { sessionId, title: '', createdAt: new Date().toISOString(), messages: [] };
  if (fs.existsSync(p.json)) doc = JSON.parse(fs.readFileSync(p.json, 'utf8'));
  if (!doc.title && entry.role === 'user') doc.title = entry.text.slice(0, 80);
  doc.messages.push({ ...entry, at: new Date().toISOString() });
  doc.updatedAt = new Date().toISOString();
  fs.writeFileSync(p.json, JSON.stringify(doc, null, 2));
  const head = fs.existsSync(p.md) ? '' : `# Research chat: ${doc.title}\n\nSession \`${sessionId}\`\n\n`;
  const who = entry.role === 'user' ? '**You**' : '**Research agent**';
  fs.appendFileSync(p.md, `${head}${who} · ${new Date().toLocaleString('en-US')}\n\n${entry.text}\n\n---\n\n`);
}

export function listThreads(root) {
  const dir = path.join(root, 'notebook', '.context', 'threads');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { sessionId: d.sessionId, title: d.title, updatedAt: d.updatedAt, count: d.messages.length };
  }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function readThread(root, sessionId) {
  const p = threadPaths(root, sessionId);
  return fs.existsSync(p.json) ? JSON.parse(fs.readFileSync(p.json, 'utf8')) : null;
}
