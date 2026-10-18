// Settings rail generated from the shared parameter schema (sim/params.js).
import { PARAMS, PRESETS, PLANETS, getPath, setPath, displayValue } from '../../sim/index.js';
import { store, emit } from '../store.js';
import { sig } from '../format.js';

const GROUPS = [
  ['world', 'World', true],
  ['entry', 'Entry interface', true],
  ['vehicle', 'Vehicle', true],
  ['guidance', 'Guidance', true],
  ['chute', 'Parachutes', false],
  ['limits', 'Limits', false],
  ['mhd', 'Magnetic braking', false, 'Speculative'],
  ['numerics', 'Numerics', false]
];

const toSlider = (m, v) => (m.log ? (1000 * Math.log(v / m.min)) / Math.log(m.max / m.min) : v);
const fromSlider = (m, x) => (m.log ? m.min * Math.pow(m.max / m.min, x / 1000) : Number(x));
const decimals = (m) => {
  if (m.log) return 3;
  const st = (m.step || 1) * (m.scale || 1);
  return st >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(st)));
};

let rows = [];

export function buildParams(root) {
  root.innerHTML = '';
  rows = [];
  for (const [id, title, open, tag] of GROUPS) {
    const det = document.createElement('details');
    det.className = 'pgroup';
    det.open = open;
    det.innerHTML = `<summary><span>${title}${tag ? `<span class="tag">${tag}</span>` : ''}</span></summary><div class="pbody"></div>`;
    const body = det.querySelector('.pbody');
    for (const m of PARAMS.filter((p) => p.group === id)) body.appendChild(row(m));
    if (id === 'vehicle') body.appendChild(derived('beta', 'Ballistic coefficient β'));
    if (id === 'entry') { body.appendChild(derived('orbit', 'Circular orbit speed here')); body.appendChild(derived('escape', 'Escape speed here')); }
    root.appendChild(det);
  }
  sync();
}

function derived(id, label) {
  const d = document.createElement('div');
  d.className = 'derived';
  d.innerHTML = `<span>${label}</span><b id="derived-${id}">–</b>`;
  return d;
}

function row(m) {
  const el = document.createElement('div');
  el.className = 'prow';
  const id = 'p-' + m.path.replace(/\./g, '-');
  if (m.type === 'enum') {
    el.innerHTML = `<div class="top"><label>${m.label}</label></div><div class="seg" role="group" aria-label="${m.label}">${m.options.map((o) => `<button type="button" data-v="${o}">${o === 'earth' || o === 'mars' ? PLANETS[o].name : o}</button>`).join('')}</div>`;
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => commit(m, b.dataset.v)));
  } else if (m.type === 'bool') {
    el.innerHTML = `<label class="toggle"><input type="checkbox" id="${id}"> ${m.label}</label>`;
    el.querySelector('input').addEventListener('change', (e) => commit(m, e.target.checked));
  } else {
    const smin = m.log ? 0 : m.min * (m.scale || 1) / (m.scale || 1);
    el.innerHTML = `<div class="top"><label for="${id}">${m.label}</label><span class="valbox"><input type="number" id="${id}-n" step="any" aria-label="${m.label} value"><span class="unit">${m.unit || ''}</span></span></div>
      <input type="range" id="${id}" min="${m.log ? 0 : smin}" max="${m.log ? 1000 : m.max}" step="${m.log ? 1 : m.step || 'any'}">`;
    const range = el.querySelector('input[type=range]');
    const num = el.querySelector('input[type=number]');
    range.addEventListener('input', () => commit(m, fromSlider(m, range.value), 'range'));
    num.addEventListener('change', () => {
      const v = Number(num.value);
      if (Number.isFinite(v)) commit(m, m.scale ? v / m.scale : v, 'num');
    });
  }
  if (m.desc) el.title = m.desc;
  rows.push({ m, el });
  return el;
}

function commit(m, value, from) {
  setPath(store.params, m.path, value);
  if (m.path === 'planet') {
    // Switching planets: start from the first preset for that planet so the entry state makes sense.
    const p = PRESETS.find((x) => x.params.planet === value);
    if (p && store.params.planet !== PRESETS.find((x) => x.key === store.presetKey)?.params.planet) {
      store.params = JSON.parse(JSON.stringify(p.params));
      store.presetKey = p.key;
      emit('preset', p.key);
    }
  }
  sync(from ? m.path : null);
  emit('params');
}

export function sync(skipPath) {
  const base = PRESETS.find((p) => p.key === store.presetKey)?.params;
  for (const { m, el } of rows) {
    const v = getPath(store.params, m.path);
    const changed = base && JSON.stringify(getPath(base, m.path)) !== JSON.stringify(v);
    el.classList.toggle('changed', !!changed);
    if (m.type === 'enum') el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    else if (m.type === 'bool') el.querySelector('input').checked = !!v;
    else {
      const range = el.querySelector('input[type=range]');
      const num = el.querySelector('input[type=number]');
      if (skipPath !== m.path || document.activeElement !== range) range.value = toSlider(m, v);
      if (document.activeElement !== num) {
        const dv = displayValue(m, v);
        num.value = m.log ? sig(dv, 3) : Number(dv.toFixed(decimals(m)));
      }
    }
  }
  const chuteOn = !!getPath(store.params, 'vehicle.chute.enabled');
  for (const { m, el } of rows) if (m.group === 'chute' && m.path !== 'vehicle.chute.enabled') el.hidden = !chuteOn;
  for (const { m, el } of rows) if (m.path === 'guidance.reversalPeriod') el.hidden = store.params.guidance.mode !== 'reversal';
  for (const { m, el } of rows) if (m.path === 'guidance.bank') el.hidden = store.params.guidance.mode === 'spin';

  const v = store.params.vehicle, P = PLANETS[store.params.planet];
  const r = P.meanRadius + store.params.entry.alt;
  setText('derived-beta', `${sig(v.mass / (v.cd * v.refArea))} kg/m²`);
  setText('derived-orbit', `${(Math.sqrt(P.mu / r) / 1000).toFixed(2)} km/s`);
  setText('derived-escape', `${(Math.sqrt((2 * P.mu) / r) / 1000).toFixed(2)} km/s`);
}
const setText = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
