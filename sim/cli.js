#!/usr/bin/env node
// Reentry Lab command-line simulator. Used by people and by the research agent.
//
//   node sim/cli.js list
//   node sim/cli.js describe
//   node sim/cli.js run   --preset lunar-return --set entry.fpa=-6.2 --set guidance.bank=30 [--json] [--csv out.csv] [--save "label"]
//   node sim/cli.js sweep --preset lunar-return --vary entry.fpa=-5:-8:-0.5 [--vary guidance.bank=0:90:30] [--metrics peakG,peakHeatFlux]
//   node sim/cli.js show  notebook/runs/<file>.json
//   node sim/cli.js context            (what the user currently has loaded in the app)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate, brief, clone, normalizeParams } from './index.js';
import { listPresets, describeText, baseFromPreset, runCommand, sweepCommand, fmtTable, DEFAULT_METRICS } from './commands.js';
import { PARAMS } from './params.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS_DIR = path.join(ROOT, 'notebook', 'runs');
const CONTEXT_FILE = path.join(ROOT, 'notebook', '.context', 'current.json');

function parseArgs(argv) {
  const out = { _: [], set: [], vary: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const val = next === undefined || next.startsWith('--') ? true : (i++, next);
      if (key === 'set' || key === 'vary') out[key].push(val);
      else out[key] = val;
    } else out._.push(a);
  }
  return out;
}

function loadBase(args) {
  if (args.from) {
    const j = JSON.parse(fs.readFileSync(path.resolve(args.from), 'utf8'));
    return { params: clone(j.params || j), label: j.label || path.basename(args.from) };
  }
  if (args.context) {
    if (!fs.existsSync(CONTEXT_FILE)) throw new Error('The app has not shared a run yet. Open Reentry Lab, or use --preset instead.');
    const j = JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8'));
    if (!j.params) throw new Error('The shared app state has no parameters yet. Use --preset instead.');
    return { params: clone(j.params), label: j.label || 'current app state' };
  }
  return baseFromPreset(args.preset);
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'run';
}

function saveRun(label, params, result, by, note) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(RUNS_DIR, `${stamp}-${slug(label)}.json`);
  const doc = { label, createdBy: by, createdAt: new Date().toISOString(), note: note || '', model: result.model, params: normalizeParams(params), summary: brief(result) };
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return path.relative(ROOT, file);
}

function writeCsv(file, result, every = 1) {
  const cols = result.columns;
  const n = result.samples.t.length;
  const lines = [cols.join(',')];
  for (let i = 0; i < n; i += every) lines.push(cols.map((c) => +result.samples[c][i].toPrecision(7)).join(','));
  fs.writeFileSync(file, lines.join('\n'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  if (cmd === 'list') {
    for (const p of listPresets()) console.log(`${p.key.padEnd(18)} ${p.name} — ${p.summary}`);
    return;
  }
  if (cmd === 'describe') {
    console.log(args.json ? JSON.stringify(PARAMS, null, 2) : describeText());
    return;
  }
  if (cmd === 'show') {
    const j = JSON.parse(fs.readFileSync(path.resolve(args._[1]), 'utf8'));
    const r = simulate(j.params);
    console.log(JSON.stringify({ label: j.label, note: j.note, summary: brief(r), events: r.events.map((e) => ({ ...e, t: +e.t.toFixed(1) })) }, null, 2));
    return;
  }
  if (cmd === 'context') {
    if (!fs.existsSync(CONTEXT_FILE)) { console.log('The app has not shared any state yet.'); return; }
    console.log(fs.readFileSync(CONTEXT_FILE, 'utf8'));
    return;
  }
  if (cmd === 'run') {
    const base = loadBase(args);
    const { params, result, output: out } = runCommand({ params: base.params, label: base.label, sets: args.set });
    if (args.csv) { writeCsv(path.resolve(args.csv), result, Number(args.every || 1)); out.csv = args.csv; }
    if (args.save) out.saved = saveRun(typeof args.save === 'string' ? args.save : base.label, params, result, args.by || 'agent', args.note);
    console.log(JSON.stringify(out, null, args.json ? 0 : 2));
    return;
  }
  if (cmd === 'sweep') {
    const base = loadBase(args);
    const metrics = args.metrics ? String(args.metrics).split(',') : DEFAULT_METRICS;
    const sweep = sweepCommand({ params: base.params, label: base.label, sets: args.set, vary: args.vary, metrics });
    if (args.json) console.log(JSON.stringify({ base: sweep.base, fixed: sweep.fixed, rows: sweep.rows }));
    else console.log(`Base: ${base.label}${args.set.length ? ' with ' + args.set.join(', ') : ''}\n` + fmtTable(sweep.rows, sweep.columns));
    return;
  }
  throw new Error(`Unknown command "${cmd}". Try: list, describe, run, sweep, show, context`);
}

try { main(); } catch (e) { console.error('Error: ' + e.message); process.exit(1); }
