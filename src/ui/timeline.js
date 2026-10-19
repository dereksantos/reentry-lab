// Playback controls: play/pause, speed, scrubbable track with a heating strip and event ticks.
import { store, emit } from '../store.js';
import { clock } from '../format.js';
import { heatCss, heatScale } from '../colormap.js';

const PLAY = '<svg viewBox="0 0 12 12"><path d="M2 1 L11 6 L2 11 Z"/></svg>';
const PAUSE = '<svg viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10"/><rect x="7" y="1" width="3" height="10"/></svg>';
let el, track, head, tclock, playBtn;

export function buildTimeline(root) {
  el = root;
  root.innerHTML = `
    <button class="play" id="playBtn" type="button" aria-label="Play">${PLAY}</button>
    <label class="speed"><span class="sr">Playback speed</span>
      <select id="speedSel">${[1, 5, 20, 60, 200, 1000, 10000].map((s) => `<option value="${s}" ${s === store.speed ? 'selected' : ''}>${s}×</option>`).join('')}</select>
    </label>
    <div class="track" id="track" role="slider" tabindex="0" aria-label="Playback time"><div class="rail"></div><div class="heat" id="heatStrip"></div><div class="head" id="head"></div></div>
    <span class="tclock" id="tclock">–</span>`;
  track = root.querySelector('#track');
  head = root.querySelector('#head');
  tclock = root.querySelector('#tclock');
  playBtn = root.querySelector('#playBtn');
  playBtn.addEventListener('click', () => setPlaying(!store.playing));
  root.querySelector('#speedSel').addEventListener('change', (e) => (store.speed = Number(e.target.value)));
  let drag = false;
  const seek = (ev) => {
    const r = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    emit('seek', f * duration());
  };
  track.addEventListener('pointerdown', (e) => { drag = true; track.setPointerCapture(e.pointerId); seek(e); });
  track.addEventListener('pointermove', (e) => drag && seek(e));
  track.addEventListener('pointerup', () => (drag = false));
  track.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowRight') emit('seek', store.playhead + step);
    if (e.key === 'ArrowLeft') emit('seek', store.playhead - step);
    if (e.key === ' ') { e.preventDefault(); setPlaying(!store.playing); }
  });
}

export function setPlaying(p) {
  store.playing = p;
  if (p && store.playhead >= duration() - 0.01) store.playhead = 0;
  playBtn.innerHTML = p ? PAUSE : PLAY;
  playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
}

const duration = () => (store.result ? store.result.samples.t[store.result.samples.t.length - 1] : 1);

export function updateTimelineRun(heatMax) {
  const r = store.result;
  if (!r) return;
  const T = duration(), s = r.samples, scale = heatScale(heatMax);
  const stops = [];
  for (let k = 0; k <= 60; k++) {
    const t = (k / 60) * T;
    let i = 0;
    while (i < s.t.length - 1 && s.t[i] < t) i++;
    stops.push(`${heatCss(scale(s.q[i]))} ${((k / 60) * 100).toFixed(1)}%`);
  }
  el.querySelector('#heatStrip').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
  track.querySelectorAll('.ev').forEach((e) => e.remove());
  const names = { peakQ: 'q max', peakG: 'g max', chute: 'chute', main: 'main', mach1: 'M1', touchdown: '', skip: 'skip', reentry: 're-entry' };
  let lastLabel = -1;
  for (const ev of r.events) {
    if (!(ev.type in names)) continue;
    const showLabel = names[ev.type] && (ev.t / T - lastLabel > 0.06);
    if (showLabel) lastLabel = ev.t / T;
    const d = document.createElement('div');
    d.className = 'ev';
    d.style.left = `${(ev.t / T) * 100}%`;
    d.title = `${ev.label} at T+${clock(ev.t)}`;
    if (showLabel) d.innerHTML = `<span>${names[ev.type]}</span>`;
    track.appendChild(d);
  }
}

export function updateTimelineHead() {
  const T = duration();
  head.style.left = `calc(${(store.playhead / T) * 100}% - 1px)`;
  tclock.textContent = `T+${clock(store.playhead)} / ${clock(T)}`;
  track.setAttribute('aria-valuenow', String(Math.round(store.playhead)));
}
