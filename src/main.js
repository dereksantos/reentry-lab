import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';

import { PRESETS, PARAMS, clone, getPath, displayValue, normalizeParams } from '../sim/index.js';
import { brief } from '../sim/simulate.js';
import { store, on, emit, persist, PIN_COLORS, cssVar, toast } from './store.js';
import { runLatest, simulateAsync } from './simClient.js';
import { sampleAt, sig, clock, escapeHtml } from './format.js';
import { heatGradient } from './colormap.js';
import { Globe } from './three/globe.js';
import { VehicleView } from './three/vehicleView.js';
import { buildParams, sync as syncParams } from './ui/params.js';
import { buildHangar, updateHangar, openHangar } from './ui/hangar.js';
import { warmSnapshots } from './three/snapshots.js';
import { buildRide, openRide, closeRide, updateRide, isRideOpen } from './ui/ride.js';
import { buildTimeline, updateTimelineRun, updateTimelineHead, setPlaying } from './ui/timeline.js';
import { renderHud } from './ui/hud.js';
import { buildCharts, updateCharts, redrawPlayhead } from './ui/charts.js';
import { buildAgent } from './ui/agent.js';
import { buildLibrary, renderPinned } from './ui/library.js';
import { openSettings } from './ui/settings.js';
import { loadHealth, isCloud, signedIn, api } from './backend.js';
import { finishOpenRouter } from './agent/providers.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const globe = new Globe(canvas, $('labels'));
const vview = new VehicleView();
let jumpToPeak = true;
let heatMax = 100;

// ---------- presets ----------
function loadPreset(key) {
  const p = PRESETS.find((x) => x.key === key);
  store.presetKey = key;
  store.params = clone(p.params);
  jumpToPeak = true;
  syncParams();
  emit('params');
}
on('preset', () => { jumpToPeak = true; });
on('open-hangar', openHangar);

function runLabel(params = store.params) {
  const p = PRESETS.find((x) => x.key === store.presetKey);
  const edited = p && JSON.stringify(normalizeParams(p.params)) !== JSON.stringify(normalizeParams(params));
  return p ? p.name + (edited ? ' (edited)' : '') : 'Custom run';
}

// ---------- simulation ----------
on('params', () => {
  persist();
  updateHangar(runLabel());
  runLatest(store.params, onResult, (b) => ($('computing').hidden = !b));
});
on('params-external', () => { syncParams(); emit('params'); });

function onResult(result) {
  const planetChanged = !store.result || store.result.params.planet !== result.params.planet;
  const jumped = jumpToPeak;
  store.result = result;
  computeHeatMax();
  globe.setPlanet(result.params.planet);
  globe.setRun(result, store.exag, heatMax);
  globe.setPins(store.pins, store.exag, store.pins.map((p) => cssVar(p.color)));
  const T = result.samples.t[result.samples.t.length - 1];
  if (jumpToPeak) { store.playhead = result.summary.timeOfPeakHeatFlux; jumpToPeak = false; if (globe.mode !== 'follow') setTimeout(() => globe.fit(), 0); }
  store.playhead = Math.min(store.playhead, T);
  updateTimelineRun(heatMax);
  updateCharts();
  renderChecks();
  renderLegend();
  refreshFrame(true);
  if (globe.mode === 'follow' && (planetChanged || jumped)) globe.setMode('follow');
  shareContext();
}

function computeHeatMax() {
  const peaks = [store.result, ...store.pins.map((p) => p.result)].filter(Boolean).map((r) => r.summary.peakHeatFlux);
  heatMax = Math.max(10, ...peaks);
}

// ---------- status chips ----------
function renderChecks() {
  const s = store.result.summary, c = s.checks;
  const chip = (state, label, value, limit) => `<span class="check" data-s="${state}" title="${label}: ${value}${limit ? ' (limit ' + limit + ')' : ''}"><span class="ic" aria-hidden="true">${state === 'ok' ? '✓' : state === 'warn' ? '!' : '✕'}</span><span class="k">${label}</span><b>${value}</b></span>`;
  const st = (chk, warnAt = 0.85) => (!chk ? 'ok' : !chk.ok ? 'crit' : chk.value > warnAt * chk.limit ? 'warn' : 'ok');
  const out = [];
  out.push(chip(st(c.heatFlux), 'Heating', `${sig(s.peakHeatFlux)} W/cm²`, `${sig(c.heatFlux.limit)} W/cm²`));
  out.push(chip(st(c.heatLoad), 'Heat load', `${sig(s.heatLoad / 1000)} kJ/cm²`, `${sig(c.heatLoad.limit / 1000)} kJ/cm²`));
  out.push(chip(st(c.gLoad), 'Peak', `${sig(c.gLoad.value)} g`, `${sig(c.gLoad.limit)} g`));
  if (c.chute) out.push(chip(st(c.chute, 0.95), 'Chute', c.chute.value == null ? 'not reached' : `Mach ${sig(c.chute.value)}`, `Mach ${c.chute.limit}`));
  const outcome = {
    landed: [c.landing.ok ? 'ok' : 'crit', 'Landing', `${sig(s.landingSpeed)} m/s`, `${c.landing.limit} m/s`],
    skipped: ['crit', 'Outcome', 'skipped out'],
    escaped: ['crit', 'Outcome', 'escaped to space'],
    timeout: ['warn', 'Outcome', 'still flying']
  }[s.outcome];
  out.push(chip(...outcome));
  $('checks').innerHTML = out.join('');
}

function renderLegend() {
  const top = heatMax;
  const ticks = [1, 10, 100, 1000].filter((t) => Math.log10(t) / Math.log10(top) < 0.82);
  const pos = (v) => (Math.log10(v) / Math.log10(top)) * 100;
  $('legend').innerHTML = `<span>Heat flux at the nose (W/cm², log)</span><div class="bar" style="background:${heatGradient()}"></div>
    <div class="ticks" style="position:relative;height:12px">${ticks.map((t) => `<span style="position:absolute;left:${pos(t)}%;transform:translateX(-50%)">${t}</span>`).join('')}<span style="position:absolute;right:0">${sig(top)}</span></div>
    <div class="runs"><span><i style="background:var(--run)"></i>This run: ${escapeHtml(runLabel())}</span>${store.pins.map((p) => `<span><i style="background:var(${p.color})"></i>${escapeHtml(p.label)}</span>`).join('')}</div>`;
}

// ---------- pins ----------
function addPin(label, params, result) {
  if (store.pins.length >= 3) store.pins.shift();
  const used = store.pins.map((p) => p.color);
  const color = PIN_COLORS.find((c) => !used.includes(c));
  const pin = { id: Math.random().toString(36).slice(2), label, color, params: clone(params), result };
  store.pins.push(pin);
  return pin;
}
function pinsChanged() {
  computeHeatMax();
  if (store.result) {
    globe.setRun(store.result, store.exag, heatMax);
    globe.setPins(store.pins, store.exag, store.pins.map((p) => cssVar(p.color)));
    updateTimelineRun(heatMax);
  }
  updateCharts();
  renderLegend();
  renderPinned();
  shareContext();
}
$('pinBtn').addEventListener('click', () => {
  if (!store.result) return;
  addPin(runLabel(), store.params, store.result);
  pinsChanged();
  toast('Pinned. Change any setting to compare against it.');
});
on('pin-current', (label) => { if (store.result) { addPin(label || runLabel(), store.params, store.result); pinsChanged(); } });
on('unpin', (id) => { store.pins = store.pins.filter((p) => p.id !== id); pinsChanged(); });
on('pin-run', async (run) => {
  const pin = addPin(run.label, normalizeParams(run.params), null);
  renderPinned();
  pin.result = await simulateAsync(pin.params);
  pinsChanged();
  toast(`Comparing with “${run.label}”`);
});
on('load-run', (run) => {
  if (store.result) addPin('Before: ' + runLabel(), store.params, store.result);
  store.params = normalizeParams(run.params);
  syncParams();
  jumpToPeak = true;
  emit('params');
  pinsChanged();
  toast(`Loaded “${run.label}”. Your previous run is pinned.`);
});

// ---------- save run ----------
$('saveRunBtn').addEventListener('click', () => {
  if (!store.result) return;
  if (!signedIn()) { toast('Sign in (Settings) to save runs.'); return; }
  const dlg = document.createElement('dialog');
  dlg.style.cssText = 'background:var(--panel-2);color:var(--ink);border:1px solid var(--rule-2);border-radius:10px;padding:16px;width:360px';
  dlg.innerHTML = `<form method="dialog" style="display:grid;gap:10px">
    <b style="font:600 16px var(--font-display);letter-spacing:.06em;text-transform:uppercase">Save run to notebook</b>
    <label style="display:grid;gap:4px">Name<input id="srLabel" required value="${escapeHtml(runLabel())}" style="background:var(--panel);border:1px solid var(--rule-2);border-radius:6px;padding:6px 8px"></label>
    <label style="display:grid;gap:4px">Note (optional)<textarea id="srNote" rows="3" style="background:var(--panel);border:1px solid var(--rule-2);border-radius:6px;padding:6px 8px"></textarea></label>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Save</button></div></form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue === 'ok') {
      const body = { label: dlg.querySelector('#srLabel').value, note: dlg.querySelector('#srNote').value, params: store.params, summary: brief(store.result), model: store.result.model };
      try {
        await api('/api/runs', { method: 'POST', body });
        emit('remote-change', 'runs');
        toast('Saved to the notebook');
      } catch (e) {
        toast(`Saving failed: ${e.message}`);
      }
    }
    dlg.remove();
  });
  dlg.showModal();
});

// ---------- context for the research agent ----------
function buildContext() {
  if (!store.result) return null;
  const preset = PRESETS.find((p) => p.key === store.presetKey);
  const changed = {};
  for (const m of PARAMS) {
    const v = getPath(store.params, m.path), b = preset && getPath(preset.params, m.path);
    if (JSON.stringify(v) !== JSON.stringify(b)) changed[m.path] = `${displayValue(m, v)}${m.unit ? ' ' + m.unit : ''} (preset: ${displayValue(m, b)})`;
  }
  const s = sampleAt(store.result, store.playhead);
  const playback = s && {
    time: `T+${clock(s.t)}`, altitude_km: +(s.alt / 1000).toFixed(2), speed_km_s: +(s.vRel / 1000).toFixed(3), mach: +s.mach.toFixed(2),
    flightPathAngle_deg: +s.fpa.toFixed(2), heatFlux_W_cm2: +s.q.toFixed(1), g: +s.g.toFixed(2), wallTemp_K: Math.round(s.tWall), chuteStage: s.chute
  };
  const p = store.params;
  const keyParams = {
    planet: p.planet, mass_kg: p.vehicle.mass, refArea_m2: p.vehicle.refArea, cd: p.vehicle.cd, noseRadius_m: p.vehicle.noseRadius, liftToDrag: p.vehicle.liftToDrag,
    guidance: `${p.guidance.mode}${p.guidance.mode !== 'spin' ? ' ' + p.guidance.bank + '°' : ''}`,
    entry: `${p.entry.alt / 1000} km, ${p.entry.speed / 1000} km/s inertial, ${p.entry.fpa}°, heading ${p.entry.azimuth}°, at ${p.entry.lat}°, ${p.entry.lon}°`,
    limits: `${p.limits.heatFlux} W/cm², ${p.limits.heatLoad / 1000} kJ/cm², ${p.limits.gLoad} g`,
    thruster: p.vehicle.thruster?.enabled ? `${p.vehicle.thruster.power / 1000} kW electric, efficiency ${p.vehicle.thruster.efficiency}, exhaust ${p.vehicle.thruster.exhaustSpeed / 1000} km/s, ${p.vehicle.thruster.propellant} kg propellant, ${p.vehicle.thruster.direction}, off below ${p.vehicle.thruster.cutoffAlt / 1000} km` : 'off'
  };
  const pinned = store.pins.filter((x) => x.result).map((x) => ({ label: x.label, results: brief(x.result) }));
  const briefCtx = { run: runLabel(), preset: store.presetKey, changedFromPreset: changed, keyParams, results: brief(store.result), lookingAt: playback, pinned };
  const full = { label: runLabel(), preset: store.presetKey, params: store.params, results: brief(store.result), events: store.result.events, lookingAt: playback, pinned: store.pins.map((x) => ({ label: x.label, params: x.params })) };
  return { brief: briefCtx, full };
}
let ctxTimer;
// Local mode only: the server writes this to notebook/.context/current.json for `node sim/cli.js run --context`.
// The hosted agent reads the context straight from this page.
function shareContext() {
  if (isCloud()) return;
  clearTimeout(ctxTimer);
  ctxTimer = setTimeout(() => {
    const c = buildContext();
    if (c) fetch('/api/context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c.full) }).catch(() => {});
  }, 800);
}

// ---------- playback + rendering ----------
on('seek', (t) => {
  if (!store.result) return;
  const T = store.result.samples.t[store.result.samples.t.length - 1];
  store.playhead = Math.max(0, Math.min(T, t));
  refreshFrame(true);
});

let lastHud = 0, lastCharts = 0, lastCtx = 0;
let current = null;
function refreshFrame(force) {
  if (!store.result) return;
  current = sampleAt(store.result, store.playhead);
  const now = performance.now();
  if (force || now - lastHud > 50) { renderHud($('hud'), current, store.result); lastHud = now; }
  globe.setPlayhead(current, heatMax);
  updateTimelineHead();
  if (force || now - lastCharts > 90) { redrawPlayhead(); lastCharts = now; }
  if (force && now - lastCtx > 2000) { lastCtx = now; shareContext(); }
}

let prev = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  if (store.playing && store.result) {
    const T = store.result.samples.t[store.result.samples.t.length - 1];
    store.playhead += dt * store.speed;
    if (store.playhead >= T) { store.playhead = T; setPlaying(false); }
    refreshFrame(false);
  }
  if (isRideOpen()) {
    // The ride-along view covers the globe, so skip drawing it.
    updateRide(current, store.result, now);
  } else {
    globe.render();
  }
  if (current && !isRideOpen()) {
    vview.update(current, store.result.params, store.result.params.planet);
    const fr = $('insetFrame').getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    vview.render(globe.renderer, { x: fr.left - cr.left, y: fr.top - cr.top, w: fr.width, h: fr.height }, cr.height);
  }
  requestAnimationFrame(loop);
}

// ---------- view controls ----------
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => {
  const m = b.dataset.cam;
  if (m === 'fit') { globe.fit(); document.querySelectorAll('[data-cam]').forEach((x) => x.dataset.cam !== 'fit' && x.setAttribute('aria-pressed', String(x.dataset.cam === 'orbit'))); return; }
  globe.setMode(m);
  document.querySelectorAll('[data-cam]').forEach((x) => x.dataset.cam !== 'fit' && x.setAttribute('aria-pressed', String(x.dataset.cam === m)));
}));
function setExag(v) {
  store.exag = Math.max(1, Math.min(40, v));
  $('exagOut').textContent = store.exag;
  if (store.result) {
    globe.setRun(store.result, store.exag, heatMax);
    globe.setPins(store.pins, store.exag, store.pins.map((p) => cssVar(p.color)));
    refreshFrame(true);
  }
  persist();
}
$('exagOut').textContent = store.exag;
$('exagUp').addEventListener('click', () => setExag(store.exag < 4 ? store.exag + 1 : store.exag + 2));
$('exagDown').addEventListener('click', () => setExag(store.exag <= 4 ? store.exag - 1 : store.exag - 2));

// ---------- panel layout: focus view, research panel, plots ----------
const app = $('app');
const ui = (() => { try { return JSON.parse(localStorage.getItem('reentry-ui')) || {}; } catch { return {}; } })();
function setLayout(key, value) {
  ui[key] = value;
  try { localStorage.setItem('reentry-ui', JSON.stringify(ui)); } catch {}
  app.classList.toggle('focus', !!ui.focus);
  app.classList.toggle('no-left', !!ui.noLeft);
  app.classList.toggle('no-right', !!ui.noRight);
  app.classList.toggle('no-plots', !!ui.noPlots);
  $('focusBtn').setAttribute('aria-pressed', String(!!ui.focus));
  for (const [id, key, name] of [['leftTab', 'noLeft', 'settings ([)'], ['rightTab', 'noRight', 'research (])'], ['bottomTab', 'noPlots', 'plots']]) {
    $(id).setAttribute('aria-expanded', String(!ui[key]));
    $(id).title = `${ui[key] ? 'Show' : 'Hide'} ${name}`;
  }
  requestAnimationFrame(updateInsets);
}
// How much of the canvas each floating panel covers, so the globe is framed in the open area.
function updateInsets() {
  const cr = canvas.getBoundingClientRect();
  const over = (sel) => { const el = document.querySelector(sel); return el && el.offsetParent && getComputedStyle(el).position === 'absolute' ? el.getBoundingClientRect() : null; };
  const T = over('.topbar'), H = over('.hud');
  const top = Math.max(T ? T.bottom - cr.top : 0, H ? H.bottom - cr.top : 0);
  if (app.classList.contains('mobile')) {
    // Phones: everything at the bottom (tab bar, playback bar, open sheet) stacks, so only the highest edge matters.
    const tops = ['.mtabs', '.bottom', '.left', '.right'].map(over).filter(Boolean).map((r) => r.top);
    globe.setInsets({ left: 0, right: 0, top, bottom: tops.length ? Math.max(0, cr.bottom - Math.min(...tops)) : 0 });
    return;
  }
  const L = over('.left'), R = over('.right'), B = over('.bottom');
  // Below 1240 px the research panel overlays the globe instead of taking space from it.
  const rightReserved = R && getComputedStyle(app).getPropertyValue('--right-res').trim() !== '-12px';
  globe.setInsets({
    left: L ? Math.max(0, L.right - cr.left) : 0,
    right: rightReserved ? Math.max(0, cr.right - R.left) : 0,
    top,
    bottom: B ? Math.max(0, cr.bottom - B.top) : 0
  });
}

// Phones (narrow, or short like a landscape phone) get the tab-bar layout; see "phones" in styles.css.
const mobileQuery = window.matchMedia('(max-width: 820px), (max-height: 500px)');
function setSheet(name) {
  app.dataset.sheet = name || '';
  document.querySelectorAll('#mtabs [data-sheet]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sheet === name)));
  requestAnimationFrame(updateInsets);
}
function applyMobile() {
  app.classList.toggle('mobile', mobileQuery.matches);
  setSheet('');
}
mobileQuery.addEventListener('change', applyMobile);
document.querySelectorAll('#mtabs [data-sheet]').forEach((b) => b.addEventListener('click', () => setSheet(app.dataset.sheet === b.dataset.sheet ? '' : b.dataset.sheet)));
on('open-hangar', () => app.classList.contains('mobile') && setSheet(''));

$('focusBtn').addEventListener('click', () => setLayout('focus', !ui.focus));
$('leftTab').addEventListener('click', () => setLayout('noLeft', !ui.noLeft));
$('rightTab').addEventListener('click', () => setLayout('noRight', !ui.noRight));
$('bottomTab').addEventListener('click', () => setLayout('noPlots', !ui.noPlots));

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  document.querySelectorAll('.tabpanel').forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
}));
on('runs-changed', () => {});

new ResizeObserver(() => updateInsets()).observe($('viewport'));

// ---------- boot ----------
const health = await loadHealth();
if (isCloud()) {
  const settingsBtn = $('settingsBtn');
  settingsBtn.hidden = false;
  settingsBtn.textContent = health.user ? health.user.name.split(' ')[0] : 'Sign in';
  settingsBtn.title = health.user ? `Signed in as ${health.user.name}. Settings and API keys` : 'Sign in, API keys and settings';
  settingsBtn.addEventListener('click', openSettings);
  if (health.supportUrl) Object.assign($('supportLink'), { hidden: false, href: health.supportUrl });
  finishOpenRouter().then((ok) => {
    if (!ok) return;
    toast('Connected to OpenRouter. Pick a model in Settings.', 4000);
    emit('agent-settings');
  }).catch((e) => toast(e.message, 5000));
}
warmSnapshots(['capsule', 'probe', 'inflatable', 'glider']);
buildHangar($('presetBtn'), $('hangar'), loadPreset);
buildRide($('ride'));
$('rideBtn').addEventListener('click', openRide);
$('mRideBtn').addEventListener('click', openRide);
applyMobile();
buildParams($('paramPanel'));
buildTimeline($('timeline'));
setLayout('focus', !!ui.focus);
buildCharts($('charts'));
buildAgent($('panel-agent'), buildContext);
buildLibrary($('panel-runs'), $('panel-notebook'));
updateInsets();
emit('params');
requestAnimationFrame(loop);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isRideOpen()) { closeRide(); return; }
  if (e.target.closest('input, textarea, select')) return;
  if (e.key === ' ') { e.preventDefault(); setPlaying(!store.playing); }
  if (e.metaKey || e.ctrlKey || e.altKey || isRideOpen()) return;
  if (e.key === 'f' || e.key === 'F') setLayout('focus', !ui.focus);
  if (e.key === '[') setLayout('noLeft', !ui.noLeft);
  if (e.key === ']') setLayout('noRight', !ui.noRight);
});
