// Simulator commands shared by the CLI (sim/cli.js) and the in-browser research agent (src/agent/tools.js).
// Pure functions: no file system, no DOM. Values in `sets` and `vary` use display units (km, km/s, degrees).

import { simulate, brief } from './simulate.js';
import { PRESETS, preset } from './presets.js';
import { PARAMS, parseAssignment, setPath, getPath, clone, displayValue } from './params.js';

export const METRIC_KEYS = {
  outcome: 'outcome', peakHeatFlux: 'peakHeatFlux_W_cm2', radiative: 'radiative_W_cm2', heatLoad: 'heatLoad_kJ_cm2',
  peakG: 'peakG', chuteG: 'peakParachuteG', dynP: 'peakDynamicPressure_kPa', wallT: 'peakWallTemp_K', downrange: 'downrange_km',
  crossrange: 'crossrange_km', landingSpeed: 'landingSpeed_m_s', chuteMach: 'chuteDeployMach', time: 'flightTime_s', harvested: 'harvestedEnergy_GJ'
};
export const DEFAULT_METRICS = ['outcome', 'peakHeatFlux', 'heatLoad', 'peakG', 'landingSpeed'];
export const MAX_SWEEP_RUNS = 400;

export function listPresets() {
  return PRESETS.map((p) => ({ key: p.key, name: p.name, summary: p.summary }));
}

export function describeParams() {
  const base = PRESETS[0].params;
  return PARAMS.map((m) => ({
    path: m.path,
    unit: m.unit || '',
    range: m.type === 'enum' ? m.options.join(' | ') : m.type === 'bool' ? 'true | false' : `${displayValue(m, m.min)} … ${displayValue(m, m.max)}`,
    label: m.label,
    desc: m.desc || '',
    example: displayValue(m, getPath(base, m.path))
  }));
}

export function describeText() {
  return describeParams().map((d) => `${d.path.padEnd(28)} ${d.unit.padEnd(7)} ${d.range.padEnd(26)} ${d.label}${d.desc ? '. ' + d.desc : ''}  [e.g. ${d.example}]`).join('\n');
}

// Base parameters for a run: a preset by key, or parameters the caller already has (the app's current run, a saved run).
export function baseFromPreset(key) {
  const p = preset(key || 'leo-capsule');
  return { params: clone(p.params), label: p.name };
}

export function applySets(params, sets = []) {
  for (const s of sets) {
    const { path, value } = parseAssignment(s);
    setPath(params, path, value);
  }
  return params;
}

export function rangeValues(spec) {
  const eq = spec.indexOf('=');
  if (eq < 0) throw new Error(`vary needs path=start:end:step, got "${spec}"`);
  const path = spec.slice(0, eq).trim();
  const [a, b, st] = spec.slice(eq + 1).split(':').map(Number);
  parseAssignment(`${path}=${a}`); // validates the path
  if (![a, b, st].every(Number.isFinite) || st === 0) throw new Error(`vary needs path=start:end:step, got "${spec}"`);
  const step = Math.sign(b - a) * Math.abs(st);
  const values = [];
  for (let v = a; step > 0 ? v <= b + 1e-9 : v >= b - 1e-9; v += step) values.push(+v.toFixed(10));
  return { path, values };
}

// One run. Returns the compact summary the agent sees, plus the full result for callers that want samples.
export function runCommand({ params, label, sets = [] }) {
  const p = applySets(clone(params), sets);
  const t0 = performance.now();
  const result = simulate(p);
  const computeMs = performance.now() - t0;
  return {
    params: p,
    result,
    output: { base: label, changes: sets, summary: brief(result), events: result.events.map((e) => ({ type: e.type, label: e.label, t: +e.t.toFixed(1) })), computeMs: +computeMs.toFixed(0) }
  };
}

export function sweepCommand({ params, label, sets = [], vary = [], metrics = DEFAULT_METRICS, maxRuns = MAX_SWEEP_RUNS }) {
  const base = applySets(clone(params), sets);
  const axes = vary.map(rangeValues);
  if (!axes.length) throw new Error('sweep needs at least one vary path=start:end:step');
  const combos = axes.reduce((acc, ax) => acc.flatMap((c) => ax.values.map((v) => [...c, [ax.path, v]])), [[]]);
  if (combos.length > maxRuns) throw new Error(`${combos.length} runs is too many for one sweep; keep it under ${maxRuns}.`);
  const rows = combos.map((combo) => {
    const p = clone(base);
    const row = {};
    for (const [k, v] of combo) {
      const meta = PARAMS.find((m) => m.path === k);
      setPath(p, k, meta && meta.scale ? v / meta.scale : v);
      row[k] = v;
    }
    const b = brief(simulate(p));
    for (const m of metrics) row[m] = b[METRIC_KEYS[m] || m]; // short names, or any key of brief()
    return row;
  });
  return { base: label, fixed: sets, columns: [...axes.map((a) => a.path), ...metrics], rows };
}

export function fmtTable(rows, cols) {
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (r) => cols.map((c, i) => String(r[c] ?? '').padStart(w[i])).join('  ');
  return [line(Object.fromEntries(cols.map((c) => [c, c]))), cols.map((_, i) => '-'.repeat(w[i])).join('  '), ...rows.map(line)].join('\n');
}
