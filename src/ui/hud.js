// Flight data readout over the 3D view, for the playback moment.
import { clock, sig } from '../format.js';

export function phase(s, result) {
  if (s.chute >= 2) return 'Main chute';
  if (s.chute >= 1) return 'Drogue';
  if (s.alt <= 1 && result.summary.outcome === 'landed' && s.t >= result.summary.flightTime - 0.5) return 'Landed';
  if (s.thrust > 0) return 'Thrusting';
  if (s.alt > 140000) return Math.abs(s.fpa) < 1 ? 'In orbit' : 'Coasting in';
  if (s.mach < 1) return 'Subsonic';
  // "Peak" only means something if the run really heats up (an orbit-only run peaks at a trace).
  if (s.q > Math.max(1, 0.5 * result.summary.peakHeatFlux)) return 'Peak heating';
  if (s.alt > 100000) return 'Coasting in';
  if (s.fpa > 0 && s.alt > 60000) return 'Climbing';
  return 'Hypersonic';
}

// Main readouts sit in a strip over the globe; the rest open below it with the "+" button.
let expanded = false;
let last = null; // latest sample and run, so the expand button redraws the current moment

export function renderHud(el, s, result) {
  if (!s) { el.innerHTML = ''; return; }
  last = { s, result };
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    el.addEventListener('click', (e) => {
      if (!e.target.closest('.moreBtn')) return;
      expanded = !expanded;
      renderHud(el, last.s, last.result);
    });
  }
  const hot = s.q > 0.5 * result.summary.peakHeatFlux;
  const main = [
    ['Altitude', (Math.max(0, s.alt) / 1000).toFixed(1), 'km'],
    ['Speed', (s.vRel / 1000).toFixed(2), 'km/s'],
    ['Mach', sig(s.mach, 3), ''],
    ['Decel', s.g.toFixed(2), 'g'],
    ['Heat flux', sig(s.q, 3), 'W/cm²', hot]
  ];
  const more = [
    ['Wall temp', s.tWall > 0 ? `${Math.round(s.tWall).toLocaleString('en-US')} K` : '–', hot],
    ['Path angle', `${s.fpa.toFixed(2)}°`],
    ['Dyn. pressure', `${sig(s.qDyn / 1000, 3)} kPa`],
    ['Heat soaked', `${sig(s.heatLoad / 1000, 3)} kJ/cm²`],
    ['Bank', `${Math.round(s.bank)}°`],
    ['Downrange', `${sig(s.downrange / 1000, 4)} km`],
    ['Air density', `${s.rho.toExponential(2)} kg/m³`]
  ];
  if (result.params.vehicle.thruster?.enabled) {
    more.push(['Thrust', s.thrust > 0 ? `${sig(s.thrust)} N` : 'off'], ['Propellant left', `${sig(s.propellant)} kg`]);
  }
  // Build the markup once (and when expanding), then only swap text, so the button survives playback.
  const shape = `${expanded}|${more.length}`;
  if (el.dataset.shape !== shape) {
    el.dataset.shape = shape;
    el.innerHTML = `<div class="strip"><div class="clock"><span data-k="clock"></span><small data-k="phase"></small></div>` +
      main.map(([k], i) => `<div class="r"><span>${k}</span><b data-k="m${i}"></b></div>`).join('') +
      `<button type="button" class="moreBtn" aria-expanded="${expanded}" aria-label="${expanded ? 'Fewer' : 'More'} flight readouts" title="More flight data">${expanded ? '−' : '+' + more.length}</button></div>` +
      (expanded ? `<div class="more">${more.map(([k], i) => `<div><span>${k}</span><b data-k="x${i}"></b></div>`).join('')}</div>` : '');
  }
  const put = (k, html, h) => { const b = el.querySelector(`[data-k="${k}"]`); if (b) { b.innerHTML = html; b.classList.toggle('hot', !!h); } };
  put('clock', `T+${clock(s.t)}`);
  put('phase', phase(s, result));
  main.forEach(([, v, u, h], i) => put(`m${i}`, `${v}${u ? `<small>${u}</small>` : ''}`, h));
  if (expanded) more.forEach(([, v, h], i) => put(`x${i}`, v, h));
}
