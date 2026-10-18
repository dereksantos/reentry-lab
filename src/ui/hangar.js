// Hangar: the mission picker. A button in the top bar opens a grid of presets, each with a picture of
// its vehicle, so choosing a mission shows what you will be flying.
import { PRESETS, PLANETS } from '../../sim/index.js';
import { store } from '../store.js';
import { sig, escapeHtml } from '../format.js';
import { vehicleSnapshot } from '../three/snapshots.js';

const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
let btn, pop;

const beta = (v) => v.mass / (v.cd * v.refArea);
const stats = (p) => `${(p.entry.speed / 1000).toFixed(1)} km/s · β ${sig(beta(p.vehicle))} kg/m²`;

export function buildHangar(button, popover, pick) {
  btn = button;
  pop = popover;
  pop.innerHTML = `<div class="hangar-head"><div><b>Hangar</b><span>Pick a mission. Each one loads a vehicle, an entry and limits you can then change.</span></div>
      <button class="ibtn" type="button" data-close aria-label="Close">${CLOSE}</button></div>
    <div class="hangar-grid">${PRESETS.map((p) => `<button type="button" class="hcard" data-key="${p.key}" aria-pressed="false">
      <span class="hpic" data-planet="${p.params.planet}"><img alt="" src="${vehicleSnapshot(p.params.vehicle.shape)}"></span>
      <span class="hname"><b>${escapeHtml(p.name)}</b><i data-planet="${p.params.planet}">${PLANETS[p.params.planet].name}</i></span>
      <span class="hstats">${stats(p.params)}</span></button>`).join('')}</div>
    <p class="hangar-sum" id="hangarSum"></p>`;

  pop.querySelectorAll('.hcard').forEach((c) => {
    c.addEventListener('click', () => { close(); pick(c.dataset.key); });
    c.addEventListener('mouseenter', () => summary(c.dataset.key));
    c.addEventListener('focus', () => summary(c.dataset.key));
  });
  pop.addEventListener('mouseleave', () => summary(store.presetKey));
  pop.querySelector('[data-close]').addEventListener('click', () => { close(); btn.focus(); });
  btn.addEventListener('click', () => (pop.hidden ? openHangar() : close()));
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close();
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); btn.focus(); return; }
    // Arrow keys move between cards in the grid.
    const cards = [...pop.querySelectorAll('.hcard')], i = cards.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = getComputedStyle(pop.querySelector('.hangar-grid')).gridTemplateColumns.split(' ').length;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (step && cards[i + step]) { e.preventDefault(); cards[i + step].focus(); }
  });
  updateHangar();
}

export function openHangar() {
  pop.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect();
  pop.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - pop.offsetWidth - 12))}px`;
  summary(store.presetKey);
  (pop.querySelector('.hcard[aria-pressed="true"]') || pop.querySelector('.hcard')).focus();
}

function close() {
  pop.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
}

function summary(key) {
  const p = PRESETS.find((x) => x.key === key);
  pop.querySelector('#hangarSum').textContent = p ? p.summary : '';
}

// The top-bar button shows the vehicle you are flying now, which may differ from the preset after edits.
export function updateHangar(label) {
  if (!btn) return;
  const p = PRESETS.find((x) => x.key === store.presetKey);
  const e = store.params.entry;
  btn.querySelector('img').src = vehicleSnapshot(store.params.vehicle.shape);
  btn.querySelector('b').textContent = label || (p ? p.name : 'Custom run');
  btn.querySelector('.psub').textContent = `${PLANETS[store.params.planet].name} · ${(e.speed / 1000).toFixed(2)} km/s · ${e.fpa}°`;
  pop.querySelectorAll('.hcard').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.key === store.presetKey)));
}
