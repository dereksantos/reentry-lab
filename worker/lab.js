// One Durable Object per signed-in user: that user's saved runs, notebook entries and research chats, in SQLite.
// Mirrors what the local server keeps in notebook/ (runs/*.json, entries/*.md, chats/*.md, .context/threads/*.json)
// so the front end sees the same API in both modes.

import { DurableObject } from 'cloudflare:workers';

const LIMITS = { runs: 500, entries: 500, threads: 300, entryChars: 200_000, threadMessages: 400, bytes: 50 * 1024 * 1024 };

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note';
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const safeName = (n) => String(n).split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '');
const safeId = (s) => String(s).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// What the Worker may call through `call()`. Custom error classes do not survive RPC, so `call()` turns them
// into { status, body } here instead of throwing across the boundary.
const METHODS = new Set(['listRuns', 'saveRun', 'listEntries', 'readEntry', 'saveNote', 'listThreads', 'readThread', 'appendThread', 'exportAll', 'deleteAll']);

export class Lab extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => this.#schema());
  }

  #schema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS runs (file TEXT PRIMARY KEY, label TEXT, created_by TEXT, created_at TEXT, note TEXT, model TEXT, params TEXT, summary TEXT);
      CREATE TABLE IF NOT EXISTS entries (name TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT, text TEXT NOT NULL, mtime INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS threads (session_id TEXT PRIMARY KEY, title TEXT, created_at TEXT, updated_at TEXT, messages TEXT NOT NULL);
    `);
  }

  async call(method, ...args) {
    if (!METHODS.has(method)) return { status: 404, body: { error: 'Unknown operation.' } };
    try {
      return { status: 200, body: await this[method](...args) };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      console.error(JSON.stringify({ msg: 'lab error', method, error: String(e?.stack || e) }));
      return { status: 500, body: { error: 'Storage error.' } };
    }
  }

  #count(table) { return this.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n; }
  #roomFor(table, limit) {
    if (this.#count(table) >= limit) throw new HttpError(507, `Storage limit reached (${limit} ${table}). Delete some or export your data.`);
    if (this.ctx.storage.sql.databaseSize > LIMITS.bytes) throw new HttpError(507, 'Storage limit reached (50 MB).');
  }

  // ---------- runs ----------
  listRuns() {
    return this.sql.exec('SELECT * FROM runs ORDER BY created_at DESC').toArray().map((r) => ({
      file: r.file, label: r.label, createdBy: r.created_by, createdAt: r.created_at, note: r.note || '',
      params: JSON.parse(r.params), summary: JSON.parse(r.summary)
    }));
  }

  saveRun({ label, note, model, params, summary, createdBy }) {
    if (!params || typeof params !== 'object') throw new HttpError(400, 'A run needs params.');
    this.#roomFor('runs', LIMITS.runs);
    const file = `${stamp()}-${slug(label || 'run')}-${crypto.randomUUID().slice(0, 4)}.json`;
    this.sql.exec('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)', file, String(label || 'Run').slice(0, 200), createdBy === 'agent' ? 'agent' : 'user',
      new Date().toISOString(), String(note || '').slice(0, 4000), model ? String(model) : null, JSON.stringify(params), JSON.stringify(summary || null));
    return { file };
  }

  // ---------- notebook entries (notes and chat logs) ----------
  listEntries() {
    return this.sql.exec('SELECT name, kind, title, mtime FROM entries ORDER BY mtime DESC').toArray();
  }

  readEntry(name) {
    const row = this.sql.exec('SELECT name, text FROM entries WHERE name = ?', safeName(name)).toArray()[0];
    if (!row) throw new HttpError(404, 'Not found.');
    return row;
  }

  // mode: 'append' (default, same as the local server: a note with the same file name gets a new section), or 'replace'.
  saveNote({ title, body, name, mode = 'append' }) {
    title = String(title || 'Note').trim().slice(0, 200);
    const file = name ? safeName(name).replace(/(\.md)?$/, '.md') : `${stamp().slice(0, 10)}-${slug(title)}.md`;
    const existing = this.sql.exec("SELECT text FROM entries WHERE name = ? AND kind = 'entry'", file).toArray()[0];
    const fresh = `# ${title}\n\n_Saved ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC from Reentry Lab_\n\n${body || ''}\n`;
    let text;
    if (existing && mode === 'append') text = `${existing.text}\n---\n\n${body || ''}\n`;
    else if (existing) text = String(body || '').startsWith('# ') ? String(body) : fresh;
    else { this.#roomFor('entries', LIMITS.entries); text = String(body || '').startsWith('# ') ? String(body) : fresh; }
    if (text.length > LIMITS.entryChars) throw new HttpError(413, `A note can be at most ${LIMITS.entryChars} characters.`);
    const heading = (text.match(/^#\s+(.+)$/m) || [, title])[1];
    this.sql.exec("INSERT OR REPLACE INTO entries VALUES (?, 'entry', ?, ?, ?)", file, heading, text, Date.now());
    return { name: file };
  }

  // ---------- research chats ----------
  listThreads() {
    return this.sql.exec('SELECT session_id, title, updated_at, messages FROM threads ORDER BY updated_at DESC').toArray()
      .map((t) => ({ sessionId: t.session_id, title: t.title, updatedAt: t.updated_at, count: JSON.parse(t.messages).length }));
  }

  readThread(sessionId) {
    const t = this.sql.exec('SELECT * FROM threads WHERE session_id = ?', safeId(sessionId)).toArray()[0];
    if (!t) throw new HttpError(404, 'No such conversation.');
    return { sessionId: t.session_id, title: t.title, createdAt: t.created_at, updatedAt: t.updated_at, messages: JSON.parse(t.messages) };
  }

  appendThread(sessionId, { role, text, model }) {
    const id = safeId(sessionId);
    if (!id || !['user', 'assistant'].includes(role) || typeof text !== 'string') throw new HttpError(400, 'Bad message.');
    text = text.slice(0, LIMITS.entryChars);
    const now = new Date().toISOString();
    const row = this.sql.exec('SELECT * FROM threads WHERE session_id = ?', id).toArray()[0];
    if (!row) this.#roomFor('threads', LIMITS.threads);
    const messages = row ? JSON.parse(row.messages) : [];
    if (messages.length >= LIMITS.threadMessages) throw new HttpError(507, 'This conversation is full. Start a new one.');
    messages.push({ role, text, at: now, ...(model ? { model: String(model).slice(0, 120) } : {}) });
    const title = row?.title || (role === 'user' ? text.slice(0, 80) : '');
    this.sql.exec('INSERT OR REPLACE INTO threads VALUES (?, ?, ?, ?, ?)', id, title, row?.created_at || now, now, JSON.stringify(messages));

    // Same Markdown transcript the local server writes to notebook/chats/<session>.md.
    const md = `${id}.md`;
    const prev = this.sql.exec('SELECT text FROM entries WHERE name = ?', md).toArray()[0];
    const head = prev ? prev.text : `# Research chat: ${title}\n\nSession \`${id}\`\n\n`;
    const who = role === 'user' ? '**You**' : `**Research agent**${model ? ` (${model})` : ''}`;
    const transcript = `${head}${who} · ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC\n\n${text}\n\n---\n\n`;
    this.sql.exec("INSERT OR REPLACE INTO entries VALUES (?, 'chat', ?, ?, ?)", md, `Research chat: ${title}`, transcript, Date.now());
    return { ok: true };
  }

  // ---------- account ----------
  exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      runs: this.listRuns(),
      entries: this.sql.exec('SELECT name, kind, title, text, mtime FROM entries').toArray(),
      threads: this.sql.exec('SELECT session_id, title, created_at, updated_at, messages FROM threads').toArray()
        .map((t) => ({ ...t, messages: JSON.parse(t.messages) }))
    };
  }

  async deleteAll() {
    await this.ctx.storage.deleteAll();
    this.#schema(); // this instance stays alive after the wipe; recreate the empty tables
    return { ok: true };
  }
}
