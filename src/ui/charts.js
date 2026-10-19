// Synced plots under the 3D view. uPlot for the time series; a small canvas plot for the speed–altitude corridor.
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { store, emit, cssVar } from '../store.js';
import { clock, sig } from '../format.js';
import { atmosphereFor, PLANETS } from '../../sim/index.js';

const DEFS = [
  { key: 'alt', title: 'Altitude', unit: 'km', f: (v) => v / 1000 },
  { key: 'vRel', title: 'Speed', unit: 'km/s', f: (v) => v / 1000 },
  { key: 'q', title: 'Heat flux', unit: 'W/cm²', f: (v) => v, limit: () => store.params.limits.heatFlux },
  { key: 'g', title: 'Deceleration', unit: 'g', f: (v) => v, limit: () => store.params.limits.gLoad }
];
let plots = [];
let vh = null;

function runsToShow() {
  const runs = [];
  if (store.result) runs.push({ label: 'This run', color: cssVar('--run'), result: store.result, width: 2 });
  for (const p of store.pins) if (p.result) runs.push({ label: p.label, color: cssVar(p.color), result: p.result, width: 1.5 });
  return runs;
}

function axis(stroke) {
  return { stroke, grid: { stroke: cssVar('--rule'), width: 1 }, ticks: { stroke: cssVar('--rule'), width: 1, size: 4 }, font: '10.5px JetBrains Mono, monospace', size: 40, gap: 3 };
}

function hooksFor(def) {
  return {
    draw: [(u) => {
      const ctx = u.ctx;
      ctx.save();
      if (def.limit) {
        const y = u.valToPos(def.limit(), 'y', true);
        if (y >= u.bbox.top && y <= u.bbox.top + u.bbox.height) {
          ctx.strokeStyle = cssVar('--crit'); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2 * devicePixelRatio;
          ctx.beginPath(); ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y); ctx.stroke();
        }
      }
      const x = u.valToPos(store.playhead, 'x', true);
      ctx.setLineDash([]); ctx.strokeStyle = cssVar('--ink'); ctx.globalAlpha = 0.8; ctx.lineWidth = 1 * devicePixelRatio;
      ctx.beginPath(); ctx.moveTo(x, u.bbox.top); ctx.lineTo(x, u.bbox.top + u.bbox.height); ctx.stroke();
      ctx.restore();
    }]
  };
}

// Axis ticks: whole hours and days get short labels so multi-day thruster runs stay readable.
const axisTime = (v) => {
  if (v >= 3600 && v % 3600 === 0) {
    const d = Math.floor(v / 86400), h = (v % 86400) / 3600;
    return d ? (h ? `${d}d ${h}h` : `${d}d`) : `${h}h`;
  }
  return clock(v);
};

export function buildCharts(root) {
  root.innerHTML = DEFS.map((d) => `<div class="chart"><h4>${d.title}<span id="cv-${d.key}">${d.unit}</span></h4><div class="plotbox" id="pb-${d.key}"></div></div>`).join('') +
    `<div class="chart"><h4>Speed vs altitude<span>corridor</span></h4><div class="plotbox" id="pb-vh"><canvas class="vh" id="vhCanvas"></canvas><div class="tip" id="vhTip" hidden></div></div></div>`;
  vh = document.getElementById('vhCanvas');
  const ro = new ResizeObserver(() => { for (const p of plots) sizePlot(p); drawVh(); });
  for (const d of DEFS) ro.observe(document.getElementById('pb-' + d.key));
  ro.observe(document.getElementById('pb-vh'));
  vh.addEventListener('click', (e) => {
    if (!store.result || !vh._map) return;
    const r = vh.getBoundingClientRect();
    const { inv } = vh._map;
    const [vx, hy] = inv(e.clientX - r.left, e.clientY - r.top);
    const s = store.result.samples;
    let best = 0, bd = Infinity;
    for (let i = 0; i < s.t.length; i++) {
      const d = ((s.vRel[i] / 1000 - vx) / 12) ** 2 + ((s.alt[i] / 1000 - hy) / 120) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    emit('seek', s.t[best]);
  });
}

function sizePlot(p) {
  const box = document.getElementById('pb-' + p.def.key);
  const w = box.clientWidth, h = box.clientHeight;
  if (w > 0 && h > 0) p.u.setSize({ width: w, height: h });
}

export function updateCharts() {
  for (const p of plots) p.u.destroy();
  plots = [];
  const runs = runsToShow();
  if (!runs.length) return;
  const ink2 = cssVar('--muted');
  for (const def of DEFS) {
    const box = document.getElementById('pb-' + def.key);
    const tables = runs.map((r) => [Array.from(r.result.samples.t), Array.from(r.result.samples[def.key], def.f)]);
    const data = runs.length === 1 ? tables[0] : uPlot.join(tables);
    const series = [{ value: (u, v) => (v == null ? '' : clock(v)) }, ...runs.map((r) => ({ label: r.label, stroke: r.color, width: r.width, spanGaps: true, points: { show: false } }))];
    const opts = {
      width: box.clientWidth || 200, height: box.clientHeight || 150,
      padding: [6, 8, 0, 0],
      legend: { show: false },
      cursor: { sync: { key: 'reentry' }, points: { size: 6 }, drag: { x: false, y: false } },
      scales: { x: { time: false }, y: { range: (u, min, max) => [0, def.limit ? Math.max(max * 1.08, Math.min(def.limit() * 1.1, max * 3)) : max * 1.05 || 1] } },
      axes: [{ ...axis(ink2), incrs: [10, 20, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 172800], space: 46, values: (u, vals) => vals.map(axisTime), size: 26 }, { ...axis(ink2), values: (u, vals) => vals.map((v) => sig(v, 3)) }],
      series,
      hooks: {
        ...hooksFor(def),
        setCursor: [(u) => {
          const i = u.cursor.idx;
          const lab = document.getElementById('cv-' + def.key);
          if (i == null) { lab.textContent = def.unit; return; }
          const vals = u.data.slice(1).map((d) => d[i]).filter((v) => v != null);
          lab.textContent = vals.length ? `${vals.map((v) => sig(v, 3)).join(' / ')} ${def.unit} at T+${clock(u.data[0][i])}` : def.unit;
        }]
      }
    };
    const u = new uPlot(opts, data, box);
    u.over.addEventListener('click', () => {
      if (u.cursor.left == null || u.cursor.left < 0) return;
      emit('seek', u.posToVal(u.cursor.left, 'x'));
    });
    plots.push({ u, def });
  }
  drawVh();
}

export function redrawPlayhead() {
  for (const p of plots) p.u.redraw(false, false);
  drawVh();
}

function shieldCurve(params, limit, hMaxKm) {
  const P = PLANETS[params.planet];
  const atm = atmosphereFor(P, params.environment.densityScale);
  const pts = [];
  for (let h = 5; h <= hMaxKm; h += 1) {
    const rho = atm(h * 1000).rho;
    const v = Math.cbrt((limit * 1e4) / (P.suttonGravesK * Math.sqrt(rho / params.vehicle.noseRadius)));
    pts.push([v / 1000, h]);
  }
  return pts;
}

function drawVh() {
  if (!vh) return;
  const box = vh.parentElement;
  const W = box.clientWidth, H = box.clientHeight;
  if (!W || !H) return;
  const dpr = devicePixelRatio || 1;
  vh.width = W * dpr; vh.height = H * dpr;
  const ctx = vh.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const runs = runsToShow();
  if (!runs.length) return;
  const vMax = Math.ceil(Math.max(...runs.map((r) => Math.max(...r.result.samples.vRel))) / 1000 + 0.5);
  const hMax = Math.ceil(Math.max(...runs.map((r) => r.result.params.entry.alt)) / 10000) * 10;
  const L = 40, R = 8, T = 6, B = 26;
  const X = (v) => L + (v / vMax) * (W - L - R);
  const Y = (h) => T + (1 - h / hMax) * (H - T - B);
  vh._map = { inv: (px, py) => [((px - L) / (W - L - R)) * vMax, (1 - (py - T) / (H - T - B)) * hMax] };
  const muted = cssVar('--muted'), rule = cssVar('--rule');
  ctx.font = '10.5px JetBrains Mono, monospace';
  ctx.fillStyle = muted; ctx.strokeStyle = rule; ctx.lineWidth = 1;
  for (let v = 0; v <= vMax; v += vMax > 8 ? 2 : 1) {
    ctx.beginPath(); ctx.moveTo(X(v), T); ctx.lineTo(X(v), H - B); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillText(String(v), X(v), H - B + 13);
  }
  for (let h = 0; h <= hMax; h += hMax > 100 ? 40 : 20) {
    ctx.beginPath(); ctx.moveTo(L, Y(h)); ctx.lineTo(W - R, Y(h)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(String(h), L - 5, Y(h) + 3);
  }
  ctx.textAlign = 'center'; ctx.fillText('km/s', W - 20, H - 3);
  ctx.save(); ctx.translate(10, T + (H - T - B) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('km', 0, 0); ctx.restore();

  // Shield limit (convective only)
  const curve = shieldCurve(store.params, store.params.limits.heatFlux, hMax);
  ctx.save();
  ctx.beginPath(); ctx.rect(L, T, W - L - R, H - T - B); ctx.clip();
  ctx.strokeStyle = cssVar('--crit'); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
  ctx.beginPath(); curve.forEach(([v, h], i) => (i ? ctx.lineTo(X(v), Y(h)) : ctx.moveTo(X(v), Y(h)))); ctx.stroke();
  ctx.setLineDash([]);
  for (const r of [...runs].reverse()) {
    const s = r.result.samples;
    ctx.strokeStyle = r.color; ctx.lineWidth = r.width;
    ctx.beginPath();
    for (let i = 0; i < s.t.length; i++) { const x = X(s.vRel[i] / 1000), y = Y(s.alt[i] / 1000); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
  if (store.result) {
    const s = store.result.samples, T0 = s.t;
    let i = 0;
    while (i < T0.length - 1 && T0[i] < store.playhead) i++;
    ctx.fillStyle = cssVar('--accent');
    ctx.beginPath(); ctx.arc(X(s.vRel[i] / 1000), Y(s.alt[i] / 1000), 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = cssVar('--crit'); ctx.textAlign = 'right';
  ctx.fillText('shield limit →', W - R - 2, T + 11);
}
