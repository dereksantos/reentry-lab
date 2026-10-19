// Settings rail generated from the shared parameter schema (sim/params.js).
import { PARAMS, PRESETS, PLANETS, getPath, setPath, displayValue } from '../../sim/index.js';
import { store, emit } from '../store.js';
import { sig } from '../format.js';
import { vehicleSnapshot } from '../three/snapshots.js';

// [id, title, open, tag, color, icon path]. The color tints the card's icon so groups are easy to tell apart.
const GROUPS = [
  ['world', 'World', true, null, '#7cc4ff', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3'],
  ['entry', 'Entry interface', true, null, '#ff9b5a', 'M4 5c6 0 11 4 14 11M18 16l-.6-4.6M18 16l-4.4-1.4'],
  ['vehicle', 'Vehicle', true, null, '#dfe7f0', 'M7 5l9 3.5v7L7 19c-1.6-3.6-1.6-10.4 0-14zM16 8.5a3.5 3.5 0 0 1 0 7'],
  ['guidance', 'Guidance', false, null, '#3ccf91', 'M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0M12 3v4M12 17v4M3 12h4M17 12h4'],
  ['thruster', 'Electric thruster', false, null, '#5ee0d0', 'M3 12h7M10 8l4 4-4 4M14 12h7M17 9l3 3-3 3'],
  ['chute', 'Parachutes', false, null, '#f2b33d', 'M4 11a8 8 0 0 1 16 0M4 11l8 9 8-9M9 11l3 9 3-9'],
  ['limits', 'Limits', false, null, '#f07b78', 'M4 17a8 8 0 1 1 16 0M12 17l4-5'],
  ['mhd', 'Magnetic braking', false, 'Speculative', '#c792ff', 'M6 4v8a6 6 0 0 0 12 0V4M6 8h4M14 8h4M10 4v8a2 2 0 0 0 4 0V4'],
  ['numerics', 'Numerics', false, null, '#8fa3b9', 'M17 5H7l6 7-6 7h10']
];

// One-line summary under each card title, so a closed card still says what is set.
const fmt = (path, d = 0) => {
  const m = PARAMS.find((x) => x.path === path);
  const v = displayValue(m, getPath(store.params, path));
  return m.log ? sig(v, 3) : Number(v.toFixed(d)).toLocaleString('en-US');
};
const SUMMARY = {
  world: () => `${PLANETS[store.params.planet].name} · density ×${fmt('environment.densityScale', 2)}`,
  entry: () => `${fmt('entry.alt')} km · ${fmt('entry.speed', 2)} km/s · ${fmt('entry.fpa', 2)}°`,
  vehicle: () => { const v = store.params.vehicle; return `${fmt('vehicle.mass')} kg · β ${sig(v.mass / (v.cd * v.refArea))} kg/m² · L/D ${v.liftToDrag}`; },
  guidance: () => { const g = store.params.guidance; return g.mode === 'spin' ? 'spin (lift averages out)' : `${g.mode} · bank ${g.bank}°`; },
  thruster: () => { const t = store.params.vehicle.thruster; return t && t.enabled ? `${fmt('vehicle.thruster.power', 1)} kW · ${fmt('vehicle.thruster.propellant')} kg · ${t.direction}` : 'Off'; },
  chute: () => (store.params.vehicle.chute.enabled ? `${fmt('vehicle.chute.deployAlt', 1)} km · ${fmt('vehicle.chute.area')} m² main` : 'Off'),
  limits: () => `${fmt('limits.heatFlux')} W/cm² · ${fmt('limits.gLoad', 1)} g · ${fmt('limits.landingSpeed', 1)} m/s`,
  mhd: () => (store.params.vehicle.mhd.factor > 0 ? `${fmt('vehicle.mhd.factor', 1)}× aero drag` : 'Off'),
  numerics: () => `${fmt('sim.maxTime')} s · tol ${fmt('sim.rtol')}`
};

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
  for (const [id, title, open, tag, color, icon] of GROUPS) {
    const det = document.createElement('details');
    det.className = 'pgroup';
    det.open = open;
    det.style.setProperty('--gc', color);
    det.innerHTML = `<summary><span class="gicon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${icon}"/></svg></span>
      <span class="gtext"><span class="gtitle">${title}${tag ? `<span class="tag">${tag}</span>` : ''}</span><span class="gsum" id="gsum-${id}"></span></span>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary><div class="pbody"></div>`;
    const body = det.querySelector('.pbody');
    for (const m of PARAMS.filter((p) => p.group === id)) body.appendChild(row(m));
    if (id === 'vehicle') { body.prepend(snapshot()); body.appendChild(derived('beta', 'Ballistic coefficient β')); }
    if (id === 'thruster') { body.appendChild(derived('thrust', 'Thrust')); body.appendChild(derived('burn', 'Propellant lasts')); body.appendChild(derived('dv', 'Total speed change')); }
    if (id === 'entry') { body.appendChild(derived('orbit', 'Circular orbit speed here')); body.appendChild(derived('escape', 'Escape speed here')); }
    root.appendChild(det);
  }
  sync();
}

// Picture of the current vehicle at the top of the Vehicle card, with a shortcut to the Hangar.
function snapshot() {
  const d = document.createElement('div');
  d.className = 'vsnap';
  d.innerHTML = `<img alt="" id="vsnapImg"><span class="vsnap-name" id="vsnapName"></span><button type="button" class="btn small" id="vsnapChange">Change</button>`;
  d.querySelector('button').addEventListener('click', () => emit('open-hangar'));
  return d;
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
    range.addEventListener('input', () => { fillRange(range); commit(m, fromSlider(m, range.value), 'range'); });
    num.addEventListener('change', () => {
      const v = Number(num.value);
      if (Number.isFinite(v)) commit(m, m.scale ? v / m.scale : v, 'num');
    });
  }
  if (m.desc) {
    el.title = m.desc;
    if (m.type !== 'bool') el.insertAdjacentHTML('beforeend', `<span class="desc">${m.desc}</span>`);
  }
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
      fillRange(range);
      if (document.activeElement !== num) {
        const dv = displayValue(m, v);
        num.value = m.log ? sig(dv, 3) : Number(dv.toFixed(decimals(m)));
      }
    }
  }
  const chuteOn = !!getPath(store.params, 'vehicle.chute.enabled');
  for (const { m, el } of rows) if (m.group === 'chute' && m.path !== 'vehicle.chute.enabled') el.hidden = !chuteOn;
  const thr = store.params.vehicle.thruster || {};
  for (const { m, el } of rows) if (m.group === 'thruster' && m.path !== 'vehicle.thruster.enabled') el.hidden = !thr.enabled;
  document.querySelectorAll('[id^="derived-thrust"], [id^="derived-burn"], [id^="derived-dv"]').forEach((b) => (b.parentElement.hidden = !thr.enabled));
  for (const { m, el } of rows) if (m.path === 'guidance.reversalPeriod') el.hidden = store.params.guidance.mode !== 'reversal';
  for (const { m, el } of rows) if (m.path === 'guidance.bank') el.hidden = store.params.guidance.mode === 'spin';

  for (const [id] of GROUPS) setText(`gsum-${id}`, SUMMARY[id]());
  const img = document.getElementById('vsnapImg');
  if (img) {
    const shape = store.params.vehicle.shape;
    img.src = vehicleSnapshot(shape);
    img.alt = `${shape} vehicle`;
    setText('vsnapName', `${shape} · ${PRESETS.find((p) => p.key === store.presetKey)?.name || 'custom'}`);
  }
  const v = store.params.vehicle, P = PLANETS[store.params.planet];
  const r = P.meanRadius + store.params.entry.alt;
  setText('derived-beta', `${sig(v.mass / (v.cd * v.refArea))} kg/m²`);
  setText('derived-orbit', `${(Math.sqrt(P.mu / r) / 1000).toFixed(2)} km/s`);
  // Thruster readouts in everyday terms: thrust as the weight of a mass on Earth, burn time, and Δv from the rocket equation.
  if (thr.enabled) {
    const F = (2 * thr.efficiency * thr.power) / thr.exhaustSpeed, mdot = F / thr.exhaustSpeed;
    const grams = (F / 9.80665) * 1000;
    const weight = grams >= 1000 ? `${sig(grams / 1000)} kg` : `${sig(grams)} g`;
    const secs = Math.min(thr.propellant, 0.95 * v.mass) / mdot;
    const burn = secs >= 172800 ? `${sig(secs / 86400)} days` : secs >= 7200 ? `${sig(secs / 3600)} hours` : `${sig(secs / 60)} min`;
    setText('derived-thrust', `${sig(F)} N (weight of ${weight})`);
    setText('derived-burn', burn);
    setText('derived-dv', `${sig(thr.exhaustSpeed * Math.log(v.mass / (v.mass - Math.min(thr.propellant, 0.95 * v.mass))))} m/s`);
  }
  setText('derived-escape', `${(Math.sqrt((2 * P.mu) / r) / 1000).toFixed(2)} km/s`);
}
// Filled part of the slider track (WebKit has no ::range-progress).
export function fillRange(r) {
  const min = Number(r.min), max = Number(r.max);
  r.style.setProperty('--p', `${((Number(r.value) - min) / (max - min)) * 100}%`);
}
const setText = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
