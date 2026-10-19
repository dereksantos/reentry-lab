// Campaign mode: Mission Control (contracts and upgrades), the mission briefing in the settings rail, launch with
// automatic time warp, and the debrief. Flights are the simulator's real runs; the game only picks the vehicle,
// limits the knobs, hides the prediction until launch and scores the result.
import { store, emit, on, toast } from '../store.js';
import { clone, getPath } from '../../sim/index.js';
import { escapeHtml } from '../format.js';
import { MISSIONS, missionById, missionParams, scoreRun } from '../game/missions.js';
import { UPGRADES, upgradeById } from '../game/upgrades.js';
import { game, saveGame, owns, unlocked, canBuy, buy, recordFlight, totalStars, resetGame } from '../game/state.js';
import { vehicleSnapshot } from '../three/snapshots.js';
import { setEditable, sync as syncParams } from './params.js';
import { setPlaying } from './timeline.js';
import { PRESETS } from '../../sim/index.js';

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
const ICONS = {
  chute: 'M4 11a8 8 0 0 1 16 0M4 11l8 9 8-9M9 11l3 9 3-9', shield: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z',
  wing: 'M3 14l18-6-4 8zM8 12.5l1 4', chip: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  ion: 'M3 12h7M10 8l4 4-4 4M14 12h7M17 9l3 3-3 3', solar: 'M4 6h7v12H4zM13 6h7v12h-7zM11 12h2',
  antigrav: 'M12 3v18M7 8l5-5 5 5M5 14h14M7 18h10'
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[k] || ICONS.chip}"/></svg>`;
const stars = (n, of = 3) => Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}">${STAR}</i>`).join('');

let app, globe, overlay, results, panel;
let mission = null; // the contract being flown
let phase = null; // 'brief' | 'flight' | 'debrief'
let labSnapshot = null; // the lab's settings, restored on leaving the campaign
let pendingLaunch = false;
let needFit = false;
let warpK = 1; // sim seconds per real second for a weight-1 moment; set at launch so every flight plays in ~22 s
let tab = 'contracts';

export const inCampaign = () => !!mission;

export function buildCampaign(ctx) {
  ({ app, globe } = ctx);
  overlay = document.getElementById('campaign');
  results = document.getElementById('debrief');
  document.getElementById('campaignBtn').addEventListener('click', () => (mission ? openControl() : openControl()));
  overlay.addEventListener('click', onControlClick);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeControl(); });
  results.addEventListener('click', onResultsClick);
  // Remember the player's knob settings per contract.
  on('params', () => {
    if (!mission || phase === 'flight') return;
    game.knobs[mission.id] = Object.fromEntries(mission.knobs.map((k) => [k, getPath(store.params, k)]));
    saveGame();
  });
  updateButton();
}

// ---------- Mission Control ----------
export function openControl() {
  renderControl();
  overlay.hidden = false;
  overlay.querySelector('[data-close]').focus();
}
function closeControl() {
  overlay.hidden = true;
}

function renderControl() {
  const contracts = MISSIONS.map((m) => {
    const open = unlocked(m), best = game.best[m.id] || 0;
    const preset = PRESETS.find((p) => p.key === m.base);
    return `<article class="contract ${open ? '' : 'locked'} ${best ? 'done' : ''}">
      <div class="c-pic"><img alt="" src="${vehicleSnapshot(preset.params.vehicle.shape)}"><span class="c-level" data-level="${m.level}">${m.level}</span></div>
      <div class="c-body">
        <div class="c-top"><b>${escapeHtml(m.title)}</b><span class="c-stars" aria-label="${best} of 3 stars">${stars(best)}</span></div>
        <p>${escapeHtml(m.brief)}</p>
        <div class="c-foot">
          <span class="c-reward">${best ? 'Replay for stars' : `+${m.reward} cr`}</span>
          ${open ? `<button type="button" class="btn primary" data-fly="${m.id}">${best ? 'Fly again' : 'Fly'}</button>`
                 : `<span class="c-need">Needs ${escapeHtml(upgradeById(m.requires).name)}</span>`}
        </div>
      </div></article>`;
  }).join('');
  const shop = UPGRADES.map((u) => {
    const st = canBuy(u);
    return `<article class="upgrade ${owns(u.id) ? 'owned' : ''}">
      <span class="u-icon ${u.fiction ? 'fiction' : ''}">${icon(u.icon)}</span>
      <div class="u-body"><b>${escapeHtml(u.name)}${u.fiction ? ' <span class="u-tag">Fictional</span>' : ''}</b><p>${escapeHtml(u.desc)}</p></div>
      ${owns(u.id) ? '<span class="u-owned">Owned</span>' : `<button type="button" class="btn ${st.ok ? 'primary' : ''}" data-buy="${u.id}" ${st.ok ? '' : 'disabled'} title="${escapeHtml(st.why || '')}">${u.cost} cr</button>`}
    </article>`;
  }).join('');
  overlay.innerHTML = `
    <div class="mc">
      <header class="mc-head">
        <div class="mc-title"><b>Mission Control</b><span>Fly contracts, earn credits, upgrade your fleet.</span></div>
        <div class="mc-wallet"><span class="mc-credits">${game.credits} cr</span><span class="mc-stars">${STAR}${totalStars()} / ${MISSIONS.length * 3}</span></div>
        <button type="button" class="ibtn" data-close aria-label="Close Mission Control"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <nav class="mc-tabs" role="tablist">
        <button type="button" role="tab" data-tab="contracts" aria-selected="${tab === 'contracts'}">Contracts</button>
        <button type="button" role="tab" data-tab="upgrades" aria-selected="${tab === 'upgrades'}">Upgrades</button>
        <button type="button" role="tab" data-tab="infra" aria-selected="${tab === 'infra'}">Satellites</button>
      </nav>
      <div class="mc-body">
        ${tab === 'contracts' ? `<div class="contracts">${contracts}</div>` : ''}
        ${tab === 'upgrades' ? `<div class="upgrades">${shop}</div>` : ''}
        ${tab === 'infra' ? `<div class="mc-soon"><b>Satellites and stations are coming.</b><p>Launch satellites that earn credits every flight, and keep them up: low orbits slowly sink from air drag, so you’ll need the ion drive to boost them.</p></div>` : ''}
      </div>
      <footer class="mc-foot">
        ${mission ? '<button type="button" class="btn" data-exit>Leave the campaign</button>' : '<span></span>'}
        <button type="button" class="btn ghost" data-reset title="Start the campaign over">Reset progress</button>
      </footer>
    </div>`;
}

function onControlClick(e) {
  const b = e.target.closest('button');
  if (e.target === overlay) return closeControl();
  if (!b) return;
  if (b.dataset.close !== undefined) return closeControl();
  if (b.dataset.tab) { tab = b.dataset.tab; renderControl(); return; }
  if (b.dataset.fly) return startMission(missionById(b.dataset.fly));
  if (b.dataset.buy) {
    const u = upgradeById(b.dataset.buy);
    if (buy(u)) { toast(`${u.name} installed`); updateButton(); renderControl(); if (mission && phase === 'brief') reloadMission(); }
    return;
  }
  if (b.dataset.exit !== undefined) { closeControl(); leaveCampaign(); return; }
  if (b.dataset.reset !== undefined) {
    if (b.dataset.armed) { resetGame(); updateButton(); renderControl(); toast('Campaign reset'); }
    else { b.dataset.armed = '1'; b.textContent = 'Click again to reset'; }
  }
}

// ---------- flying a contract ----------
function startMission(m) {
  if (!mission) labSnapshot = store.labSaved = { params: clone(store.params), presetKey: store.presetKey };
  mission = m;
  closeControl();
  results.hidden = true;
  app.classList.add('game');
  reloadMission();
  if (app.classList.contains('mobile')) emit('mobile-sheet', 'settings');
}

function reloadMission() {
  needFit = true;
  setPhase('brief');
  store.params = missionParams(mission, game.owned, game.knobs[mission.id] || {});
  store.presetKey = mission.base;
  setEditable(mission.knobs);
  syncParams();
  globe.setTarget(mission.target || null, store.params.planet);
  setPlaying(false);
  emit('params');
  emit('seek', 0);
  renderPanel();
  updateButton();
}

function setPhase(p) {
  phase = p;
  app.dataset.phase = p;
  globe.setReveal(p === 'flight' ? 'trail' : p === 'debrief' || owns('computer') ? 'full' : 'hidden');
  if (panel) renderPanel();
}

function launch() {
  if (document.getElementById('computing') && !document.getElementById('computing').hidden) { pendingLaunch = true; return; }
  pendingLaunch = false;
  warpK = warpFor(store.result);
  if (app.classList.contains('mobile')) emit('mobile-sheet', ''); // close the sheet to watch the flight
  setPhase('flight');
  emit('seek', 0);
  setPlaying(true);
}

// Called by main.js for every new simulation result.
export function campaignResult() {
  if (!mission) return;
  if (needFit) { needFit = false; setTimeout(() => globe.fit(), 0); }
  if (pendingLaunch) launch();
}

// Space bar: during a briefing it launches instead of scrubbing through a hidden flight. Returns true if handled.
export function campaignSpace() {
  if (!mission || phase !== 'brief') return false;
  launch();
  return true;
}

// Time warp. Each moment gets a weight for how much screen time it deserves: heating and g-force most, parachute
// descents and thin air less, orbit hardly any. The flight's total weighted time is spread over PLAYBACK seconds.
const PLAYBACK = 22;
const weight = (s) => (s.alt > 140000 ? 0.03 : s.q > 2 || s.g > 0.3 ? 1 : s.chute > 0 ? 0.25 : 0.12);
function warpFor(result) {
  if (!result) return 30;
  const S = result.samples;
  let W = 0;
  for (let i = 1; i < S.t.length; i++) W += (S.t[i] - S.t[i - 1]) * weight({ alt: S.alt[i], q: S.q[i], g: S.g[i], chute: S.chute[i] });
  return W / PLAYBACK;
}

// Called every animation frame: time warp during a flight, and the debrief at the end.
export function campaignTick(sample, result) {
  if (!mission || phase !== 'flight' || !sample || !result) return;
  const T = result.samples.t[result.samples.t.length - 1];
  store.speed = Math.min(50000, Math.max(6, warpK / weight(sample)));
  if (!store.playing && store.playhead >= T - 1e-6) finish(result);
}

function finish(result) {
  const sc = scoreRun(mission, result.summary);
  const { earned, prev } = recordFlight(mission, sc.stars);
  setPhase('debrief');
  updateButton();
  const next = MISSIONS.find((m) => m !== mission && unlocked(m) && !game.best[m.id]);
  const row = (o, star) => `<li class="${o.ok ? 'ok' : 'no'}"><span class="mark">${o.ok ? '✓' : '✕'}</span><span class="lab">${star ? STAR : ''}${escapeHtml(o.label)}</span><span class="val">${escapeHtml(String(o.value))}</span></li>`;
  results.innerHTML = `
    <div class="db" role="dialog" aria-modal="true" aria-labelledby="dbTitle">
      <span class="db-kicker">${escapeHtml(mission.title)}</span>
      <h2 id="dbTitle">${sc.complete ? (sc.stars === 3 ? 'Flawless!' : 'Contract complete') : 'Mission failed'}</h2>
      <div class="db-stars ${sc.complete ? '' : 'fail'}">${stars(sc.stars)}</div>
      <ul class="db-list">${sc.goal.map((o) => row(o, false)).join('')}${sc.bonus.map((o) => row(o, true)).join('')}</ul>
      <p class="db-pay">${earned ? `+${earned} credits` : sc.complete && prev >= sc.stars ? 'No new stars this time' : 'Tune the knobs and try again'}<span>Balance ${game.credits} cr</span></p>
      <div class="db-acts">
        <button type="button" class="btn" data-act="review">Look at the flight</button>
        <button type="button" class="btn" data-act="retry">Retry</button>
        ${sc.complete && next ? `<button type="button" class="btn primary" data-act="next" data-id="${next.id}">Next: ${escapeHtml(next.title)}</button>` : ''}
        <button type="button" class="btn ${sc.complete && next ? '' : 'primary'}" data-act="control">Mission Control</button>
      </div>
    </div>`;
  results.hidden = false;
  results.querySelector('.btn.primary')?.focus();
}

function onResultsClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  results.hidden = true;
  if (b.dataset.act === 'retry') reloadMission();
  if (b.dataset.act === 'next') startMission(missionById(b.dataset.id));
  if (b.dataset.act === 'control') openControl();
}

export function leaveCampaign() {
  if (!mission) return;
  mission = null;
  phase = null;
  pendingLaunch = false;
  delete app.dataset.phase;
  app.classList.remove('game');
  results.hidden = true;
  setEditable(null);
  panel?.remove();
  panel = null;
  globe.setTarget(null);
  globe.setReveal('full');
  setPlaying(false);
  store.speed = 20;
  if (labSnapshot) { store.params = labSnapshot.params; store.presetKey = labSnapshot.presetKey; }
  labSnapshot = store.labSaved = null;
  syncParams();
  emit('preset', store.presetKey);
  emit('params');
  updateButton();
}

// The briefing card at the top of the settings rail.
function renderPanel() {
  const left = document.getElementById('paramPanel');
  if (!panel) { panel = document.createElement('section'); panel.className = 'mission-card glass'; left.prepend(panel); panel.addEventListener('click', onPanelClick); }
  const m = mission;
  const li = (o, star) => `<li>${star ? `<i>${STAR}</i>` : '<i class="dot"></i>'}${escapeHtml(o.label)}</li>`;
  const flying = phase === 'flight';
  panel.innerHTML = `
    <div class="mcard-top"><span class="c-level" data-level="${m.level}">${m.level}</span><button type="button" class="btn small ghost" data-act="control">Mission Control</button></div>
    <b class="mcard-title">${escapeHtml(m.title)}</b>
    <p class="mcard-brief">${escapeHtml(m.brief)}</p>
    <ul class="mcard-goals">${m.goal.map((o) => li(o, false)).join('')}${m.bonus.map((o) => li(o, true)).join('')}</ul>
    ${phase === 'brief' ? `<p class="mcard-hint">${owns('computer') ? 'Flight computer: the predicted path is on the globe.' : 'Set the knobs below, then launch. The path stays hidden until you fly.'}</p>` : ''}
    <div class="mcard-acts">
      ${flying ? '<button type="button" class="btn" data-act="skip">Skip to the end</button>'
               : `<button type="button" class="btn primary launch" data-act="launch">${phase === 'debrief' ? 'Fly again' : 'Launch'}</button>`}
    </div>`;
}

function onPanelClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'control') return openControl();
  if (b.dataset.act === 'launch') {
    if (phase === 'debrief') { setPhase('brief'); emit('seek', 0); }
    return launch();
  }
  if (b.dataset.act === 'skip' && store.result) {
    const s = store.result.samples.t;
    setPlaying(false);
    emit('seek', s[s.length - 1]);
    finish(store.result);
  }
}

function updateButton() {
  const b = document.getElementById('campaignBtn');
  if (!b) return;
  b.querySelector('span').textContent = mission ? `${game.credits} cr` : 'Campaign';
  b.title = mission ? 'Mission Control' : 'Play the campaign: fly contracts, earn credits, buy upgrades';
}
