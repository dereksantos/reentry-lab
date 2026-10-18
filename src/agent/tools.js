// Tools for the in-browser research agent (hosted mode). They cover what the local agent does with Claude Code's
// Read/Bash/Write tools: run the simulator (in the Web Worker, on this machine), read its source, read the app
// state, and keep the notebook (in the user's account). Web search comes from the provider (see anthropic.js).

import { simCommand } from '../simClient.js';
import { listPresets, describeText, baseFromPreset, fmtTable, DEFAULT_METRICS, METRIC_KEYS } from '../../sim/commands.js';
import { PRESETS } from '../../sim/presets.js';
import { api } from '../backend.js';
import { emit } from '../store.js';

const SOURCES = import.meta.glob('../../sim/*.js', { query: '?raw', import: 'default' });
const SOURCE_FILES = Object.keys(SOURCES).map((k) => k.split('/').pop()).sort();
const MAX_RESULT_CHARS = 30_000;

const str = (v, max) => typeof v === 'string' && v.trim() && v.length <= max;
const clip = (s) => (s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + `\n…[cut at ${MAX_RESULT_CHARS} characters]` : s);

function changesToSets(changes) {
  if (changes == null) return [];
  if (typeof changes !== 'object' || Array.isArray(changes)) throw new Error('changes must be an object of parameter path → value.');
  return Object.entries(changes).map(([k, v]) => `${k}=${v}`);
}

function baseFor(input, getContext) {
  if (input.preset) {
    if (!PRESETS.some((p) => p.key === input.preset)) throw new Error(`Unknown preset "${input.preset}". Presets: ${PRESETS.map((p) => p.key).join(', ')}`);
    return baseFromPreset(input.preset);
  }
  const ctx = getContext();
  if (!ctx?.full?.params) throw new Error('No run is loaded in the app yet. Pass a preset instead.');
  return { params: ctx.full.params, label: ctx.full.label || 'current app state' };
}

const PRESET_PROP = { type: 'string', description: `Start from this preset instead of the run loaded in the app. One of: ${PRESETS.map((p) => p.key).join(', ')}.` };
const CHANGES_PROP = {
  type: 'object',
  description: 'Parameter changes as { "path": value } in display units (km, km/s, degrees), e.g. { "entry.fpa": -6.2, "guidance.bank": 30 }. Paths are listed by describe_parameters.',
  additionalProperties: { type: ['number', 'string', 'boolean'] }
};

export function buildTools({ getContext, signedIn, fetchTool }) {
  const tools = [
    {
      name: 'list_presets',
      description: 'List the mission presets (key, name, one-line summary).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      describe: () => ({ kind: 'sim', text: 'Listing presets' }),
      run: async () => listPresets().map((p) => `${p.key.padEnd(18)} ${p.name} — ${p.summary}`).join('\n')
    },
    {
      name: 'describe_parameters',
      description: 'List every simulator parameter: path, display unit, allowed range, meaning and an example value.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      describe: () => ({ kind: 'sim', text: 'Reading the parameter list' }),
      run: async () => describeText()
    },
    {
      name: 'get_app_state',
      description: 'What the user has loaded in the app right now: preset, full parameters, results, events, the playback moment they are looking at, and pinned comparison runs. A short version is already in <app_context> when they share it.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      describe: () => ({ kind: 'file', text: 'Reading the app state' }),
      run: async () => {
        const ctx = getContext();
        return ctx ? JSON.stringify(ctx.full, null, 1) : 'No run is loaded in the app yet.';
      }
    },
    {
      name: 'run_simulation',
      description: 'Run one simulation and get its summary (outcome, peak heating, heat load, peak g, landing speed, …) and event times. Starts from the run loaded in the app unless a preset is given. Optionally save it to the notebook, where the user can load or compare it.',
      parameters: {
        type: 'object',
        properties: {
          preset: PRESET_PROP,
          changes: CHANGES_PROP,
          save_label: { type: 'string', description: 'Save the run to the notebook under this short label.' },
          save_note: { type: 'string', description: 'Why this run matters (saved with it).' }
        },
        additionalProperties: false
      },
      describe: (i) => ({ kind: 'sim', text: `Running simulator: ${i.preset || 'current run'}${i.changes ? ' with ' + changesToSets(i.changes).join(', ') : ''}` }),
      run: async (input) => {
        const base = baseFor(input, getContext);
        const { params, output, model } = await simCommand('run', { params: base.params, label: base.label, sets: changesToSets(input.changes) });
        if (input.save_label) {
          if (!signedIn()) output.saved = 'Not saved: the user is not signed in.';
          else {
            const r = await api('/api/runs', { method: 'POST', body: { label: String(input.save_label).slice(0, 200), note: input.save_note || '', params, summary: output.summary, model, createdBy: 'agent' } });
            output.saved = r.file;
            emit('remote-change', 'runs');
          }
        }
        return JSON.stringify(output, null, 1);
      }
    },
    {
      name: 'sweep',
      description: `Run a grid of simulations, varying one to three parameters, and get a table of metrics. Keep it under about 100 runs (hard limit 400). Metrics: ${Object.keys(METRIC_KEYS).join(', ')}.`,
      parameters: {
        type: 'object',
        properties: {
          preset: PRESET_PROP,
          changes: { ...CHANGES_PROP, description: 'Fixed changes applied before sweeping, same format as run_simulation.' },
          vary: {
            type: 'array', minItems: 1, maxItems: 3,
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, step: { type: 'number' } },
              required: ['path', 'start', 'end', 'step'], additionalProperties: false
            }
          },
          metrics: { type: 'array', items: { type: 'string' }, description: `Columns to report. Default: ${DEFAULT_METRICS.join(', ')}.` }
        },
        required: ['vary'],
        additionalProperties: false
      },
      describe: (i) => ({ kind: 'sim', text: `Running sweep: ${(i.vary || []).map((v) => `${v.path} ${v.start}…${v.end}`).join(' × ')}` }),
      run: async (input) => {
        if (!Array.isArray(input.vary) || !input.vary.length) throw new Error('vary needs at least one { path, start, end, step }.');
        const base = baseFor(input, getContext);
        const vary = input.vary.map((v) => `${v.path}=${v.start}:${v.end}:${v.step}`);
        const metrics = Array.isArray(input.metrics) && input.metrics.length ? input.metrics.map(String) : DEFAULT_METRICS;
        const sets = changesToSets(input.changes);
        const s = await simCommand('sweep', { params: base.params, label: base.label, sets, vary, metrics });
        return `Base: ${base.label}${sets.length ? ' with ' + sets.join(', ') : ''}\n` + fmtTable(s.rows, s.columns);
      }
    },
    {
      name: 'read_simulator_source',
      description: 'Read a source file of the simulator to see exactly what the model does.',
      parameters: { type: 'object', properties: { file: { type: 'string', enum: SOURCE_FILES } }, required: ['file'], additionalProperties: false },
      describe: (i) => ({ kind: 'file', text: `Reading sim/${i.file}` }),
      run: async (input) => {
        const loader = SOURCES[`../../sim/${input.file}`];
        if (!loader) throw new Error(`No such file. Files: ${SOURCE_FILES.join(', ')}`);
        return await loader();
      }
    }
  ];

  if (signedIn()) {
    tools.push(
      {
        name: 'list_saved_runs',
        description: 'List runs saved in the notebook (by the user or by you), newest first, with their summaries.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        describe: () => ({ kind: 'file', text: 'Looking through saved runs' }),
        run: async () => {
          const runs = await api('/api/runs');
          return runs.length ? JSON.stringify(runs.slice(0, 50).map((r) => ({ file: r.file, label: r.label, by: r.createdBy, at: r.createdAt, note: r.note, summary: r.summary })), null, 1) : 'No saved runs yet.';
        }
      },
      {
        name: 'list_notes',
        description: 'List notebook entries (research notes and chat logs), newest first.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        describe: () => ({ kind: 'file', text: 'Looking through the notebook' }),
        run: async () => {
          const list = await api('/api/notebook');
          return list.length ? list.map((e) => `${e.name}  [${e.kind}]  ${e.title}`).join('\n') : 'The notebook is empty.';
        }
      },
      {
        name: 'read_note',
        description: 'Read one notebook entry by file name (from list_notes).',
        parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
        describe: (i) => ({ kind: 'file', text: `Reading notebook/${i.name}` }),
        run: async (input) => (await api('/api/notebook/' + encodeURIComponent(input.name))).text
      },
      {
        name: 'write_note',
        description: 'Create a research note in the notebook, add a section to one, or replace one. Markdown. Record the question, what you ran (tool calls and settings), results, sources and open questions.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Note title (also used for the file name of a new note).' },
            body: { type: 'string', description: 'Markdown body. For replace, may start with its own "# Title" line.' },
            file: { type: 'string', description: 'Existing file name to append to or replace (from list_notes). Omit for a new note.' },
            mode: { type: 'string', enum: ['append', 'replace'], description: 'For an existing file: add a section (default) or replace the whole note.' }
          },
          required: ['title', 'body'],
          additionalProperties: false
        },
        describe: (i) => ({ kind: 'write', text: `Writing notebook/${i.file || i.title || 'note'}` }),
        run: async (input) => {
          if (!str(input.title, 200) || typeof input.body !== 'string') throw new Error('write_note needs a title (up to 200 characters) and a body.');
          const r = await api('/api/notebook', { method: 'POST', body: { title: input.title, body: input.body, name: input.file || undefined, mode: input.mode || 'append' } });
          emit('remote-change', 'notebook');
          return `Saved notebook/${r.name}`;
        }
      }
    );
  }

  if (fetchTool && signedIn()) {
    tools.push({
      name: 'fetch_url',
      description: 'Fetch a web page (HTML or plain text, not PDF) and get its readable text. Use for NASA NTRS landing pages, papers, mission reports and documentation. Cite what you use.',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full http(s) URL.' } }, required: ['url'], additionalProperties: false },
      describe: (i) => {
        let host = i.url || '';
        try { host = new URL(i.url).host; } catch {}
        return { kind: 'read', text: `Reading ${host}`, url: i.url };
      },
      run: async (input) => fetchReadable(String(input.url || ''))
    });
  }
  return tools;
}

// Fetch through /api/fetch and turn the page into text here, in the browser (DOMParser never runs page scripts).
async function fetchReadable(url) {
  const r = await fetch('/api/fetch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Fetch failed (${r.status})`);
  const type = r.headers.get('x-upstream-content-type') || '';
  const charset = (type.match(/charset=([\w-]+)/i) || [, 'utf-8'])[1];
  let text;
  try { text = new TextDecoder(charset).decode(await r.arrayBuffer()); } catch { text = new TextDecoder().decode(await r.arrayBuffer()); }
  const status = r.headers.get('x-upstream-status');
  const finalUrl = r.headers.get('x-final-url') || url;
  if (/html|xml/i.test(type)) {
    const doc = new DOMParser().parseFromString(text, /xhtml|\/xml/i.test(type) && !/html/i.test(type) ? 'text/xml' : 'text/html');
    doc.querySelectorAll('script, style, noscript, svg, nav, footer, header, form, iframe').forEach((el) => el.remove());
    const title = doc.querySelector('title')?.textContent?.trim() || '';
    text = `${title ? `Title: ${title}\n` : ''}${(doc.body || doc.documentElement)?.textContent || ''}`;
  }
  text = text.replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return clip(`URL: ${finalUrl}\nHTTP status: ${status}\n\n${text}`);
}
