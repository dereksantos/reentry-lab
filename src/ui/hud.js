// Flight data readout over the 3D view, for the playback moment.
import { clock, sig } from '../format.js';

function phase(s, result) {
  if (s.chute >= 2) return 'Main chute';
  if (s.chute >= 1) return 'Drogue';
  if (s.alt <= 1 && result.summary.outcome === 'landed' && s.t >= result.summary.flightTime - 0.5) return 'Landed';
  if (s.mach < 1) return 'Subsonic';
  if (s.q > 0.5 * result.summary.peakHeatFlux) return 'Peak heating';
  if (s.alt > 100000) return 'Coasting in';
  if (s.fpa > 0 && s.alt > 60000) return 'Climbing';
  return 'Hypersonic';
}

export function renderHud(el, s, result) {
  if (!s) { el.innerHTML = ''; return; }
  const hot = s.q > 0.5 * result.summary.peakHeatFlux;
  const rows = [
    ['Altitude', `${(s.alt / 1000).toFixed(1)} km`],
    ['Speed', `${(s.vRel / 1000).toFixed(2)} km/s`],
    ['Mach', sig(s.mach, 3)],
    ['Path angle', `${s.fpa.toFixed(2)}°`],
    ['Deceleration', `${s.g.toFixed(2)} g`],
    ['Dyn. pressure', `${sig(s.qDyn / 1000, 3)} kPa`],
    ['Heat flux', `${sig(s.q, 3)} W/cm²`, hot],
    ['Wall temp', s.tWall > 0 ? `${Math.round(s.tWall).toLocaleString('en-US')} K` : '–', hot],
    ['Heat soaked', `${sig(s.heatLoad / 1000, 3)} kJ/cm²`],
    ['Bank', `${Math.round(s.bank)}°`],
    ['Downrange', `${sig(s.downrange / 1000, 4)} km`],
    ['Air density', `${s.rho.toExponential(2)} kg/m³`]
  ];
  el.innerHTML = `<div class="clock">T+${clock(s.t)}<small>${phase(s, result)}</small></div>` +
    rows.map(([k, v, h]) => `<div class="r"><span>${k}</span><b class="${h ? 'hot' : ''}">${v}</b></div>`).join('');
}
