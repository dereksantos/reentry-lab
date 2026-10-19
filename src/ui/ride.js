// Ride along: the current run seen from a capsule window, with flight instruments and live sound.
// Driven by the app's playback clock, so play, pause and seeking work the same as in the mission view.
// The window is SVG: sky colour and horizon curvature follow altitude, plasma follows heat flux,
// the cabin shakes with dynamic pressure and g, and the parachutes open on the run's own events.
import { store, emit } from '../store.js';
import { clock, sig, escapeHtml } from '../format.js';
import { heatCss, heatScale } from '../colormap.js';
import { phase } from './hud.js';
import { setPlaying } from './timeline.js';
import { EntrySound } from '../audio/entrySound.js';

// Sky by altitude (km): [alt, top colour, horizon colour]
const SKY = {
  earth: [[0, [70, 132, 200], [205, 228, 245]], [3, [52, 112, 184], [176, 212, 240]], [12, [26, 74, 140], [120, 172, 225]], [30, [6, 20, 48], [48, 104, 176]], [60, [1, 3, 8], [14, 40, 86]], [100, [0, 0, 0], [3, 8, 18]]],
  mars: [[0, [150, 104, 72], [228, 186, 140]], [5, [120, 80, 56], [214, 160, 112]], [15, [60, 38, 28], [176, 116, 80]], [35, [12, 8, 8], [84, 50, 34]], [70, [0, 0, 0], [10, 6, 6]]]
};
// Ground seen from high up, then near the surface: [rim, edge]
const GROUND = {
  earth: { hi: [[18, 57, 95], [44, 106, 160]], lo: [[77, 107, 60], [157, 183, 201]] },
  mars: { hi: [[107, 48, 24], [184, 103, 58]], lo: [[154, 90, 52], [217, 167, 122]] }
};
const SPEEDS = [1, 5, 20, 60, 200, 1000, 10000];
const PLAY = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.2v9.6L10.6 6z"/></svg>';
const PAUSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5h2.4v9H2.5zM7.1 1.5h2.4v9H7.1z"/></svg>';
const SOUND_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const SOUND_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6"/></svg>';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;
const mixC = (a, b, t) => a.map((v, k) => mix(v, b[k], t));
function sky(planet, alt) {
  const T = SKY[planet] || SKY.earth;
  if (alt >= T[T.length - 1][0]) return [T[T.length - 1][1], T[T.length - 1][2]];
  for (let i = 0; i < T.length - 1; i++) {
    if (alt <= T[i + 1][0]) { const f = (alt - T[i][0]) / (T[i + 1][0] - T[i][0]); return [mixC(T[i][1], T[i + 1][1], f), mixC(T[i][2], T[i + 1][2], f)]; }
  }
  return [T[0][1], T[0][2]];
}

// Fixed decoration, generated once with a seeded random so it looks the same every time.
function seeded(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const STARS = (() => { const r = seeded(42); return Array.from({ length: 70 }, () => `<circle cx="${(r() * 600).toFixed(1)}" cy="${(r() * 420).toFixed(1)}" r="${(0.5 + r() * 1.2).toFixed(2)}" opacity="${(0.35 + r() * 0.65).toFixed(2)}"/>`).join(''); })();
const STREAKS = (() => { const r = seeded(7); return Array.from({ length: 22 }, () => { const x = r() * 700 - 50, y = r() * 700 - 50, l = 30 + r() * 90; return `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x + l).toFixed(0)}" y2="${(y - l * 0.73).toFixed(0)}" stroke-width="${(1 + r() * 2.2).toFixed(1)}" stroke-opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`; }).join(''); })();
const BOLTS = Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return `<circle cx="${(300 + Math.cos(a) * 279).toFixed(1)}" cy="${(300 + Math.sin(a) * 279).toFixed(1)}" r="4.5"/>`; }).join('');

const TEMPLATE = `
  <header class="ride-head">
    <button class="btn" type="button" data-r="close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Mission view</button>
    <div class="ride-title"><b>Ride along</b><span data-r="mission"></span></div>
    <span class="ride-hint">Esc to leave · Space to play</span>
  </header>
  <main class="ride-win">
    <div class="porthole" data-r="porthole">
      <svg viewBox="0 0 600 600" role="img" aria-label="View from the vehicle window" data-r="svg">
        <defs>
          <clipPath id="rwClip"><circle cx="300" cy="300" r="262"/></clipPath>
          <linearGradient id="rwSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" data-r="skyTop"/><stop offset="1" data-r="skyHor"/></linearGradient>
          <radialGradient id="rwGround" cx="300" cy="900" r="600" gradientUnits="userSpaceOnUse" data-r="groundGrad">
            <stop offset="0.9" data-r="groundA"/><stop offset="0.995" data-r="groundB"/><stop offset="1" data-r="groundC"/>
          </radialGradient>
          <radialGradient id="rwPlasma" cx="0.15" cy="0.92" r="0.95">
            <stop offset="0" stop-color="#fff6e6"/><stop offset="0.18" stop-color="#ffc06a"/><stop offset="0.45" stop-color="#ff6a2a" stop-opacity="0.85"/>
            <stop offset="0.75" stop-color="#d0306a" stop-opacity="0.35"/><stop offset="1" stop-color="#5a1a8a" stop-opacity="0"/>
          </radialGradient>
          <filter id="rwClouds" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="4" seed="11" data-r="turb"/>
            <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 2.6 -1.35"/>
          </filter>
          <filter id="rwBlur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>
          <linearGradient id="rwRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a6470"/><stop offset="0.5" stop-color="#1c2128"/><stop offset="1" stop-color="#3a424c"/></linearGradient>
          <linearGradient id="rwGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="0.7" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.06"/></linearGradient>
        </defs>
        <g clip-path="url(#rwClip)">
          <g data-r="outside">
            <rect x="-200" y="-200" width="1000" height="1000" fill="url(#rwSky)"/>
            <g fill="#fff" data-r="stars">${STARS}</g>
            <circle cx="300" cy="900" r="600" fill="url(#rwGround)" data-r="ground"/>
            <rect x="-200" y="300" width="1000" height="900" filter="url(#rwClouds)" data-r="clouds"/>
            <g class="puffs" filter="url(#rwBlur)" data-r="puffs">
              <ellipse cx="160" cy="300" rx="150" ry="60" fill="#f4f7fa"/><ellipse cx="430" cy="300" rx="180" ry="70" fill="#e9eef3"/>
              <ellipse cx="300" cy="300" rx="120" ry="45" fill="#fff"/><ellipse cx="520" cy="300" rx="110" ry="40" fill="#f0f4f8"/>
            </g>
          </g>
          <g data-r="chute">
            <path stroke="#d8dde3" stroke-opacity="0.5" stroke-width="1.2" fill="none" data-r="risers"/>
            <path data-r="canopy"/>
            <path fill="none" stroke="#fff" stroke-width="10" stroke-opacity="0.85" stroke-dasharray="26 30" data-r="gores"/>
          </g>
          <g class="plasma" data-r="plasma">
            <rect width="600" height="600" fill="url(#rwPlasma)" class="flicker"/>
            <g class="streaks" stroke="#ffd9a8" stroke-linecap="round">${STREAKS}</g>
          </g>
          <rect width="600" height="600" fill="#ff7a2e" data-r="tint"/>
        </g>
        <circle cx="300" cy="300" r="262" fill="url(#rwGlass)"/>
        <path d="M120 170 Q190 80 300 66" fill="none" stroke="#fff" stroke-opacity="0.13" stroke-width="10" stroke-linecap="round"/>
        <circle cx="300" cy="300" r="279" fill="none" stroke="url(#rwRing)" stroke-width="34"/>
        <circle cx="300" cy="300" r="262" fill="none" stroke="#05070a" stroke-width="4"/>
        <g fill="#20262d" stroke="#6b7580" stroke-width="1.2">${BOLTS}</g>
      </svg>
      <span class="ride-note" data-r="note"></span>
    </div>
  </main>
  <aside class="ride-mfd" aria-label="Flight instruments">
    <div class="mfd-top">
      <span class="mfd-clock" data-r="clock"></span>
      <span class="mfd-phase" data-r="phase"></span>
      <span class="mfd-blackout" data-r="blackout">Plasma sheath · radio blackout likely</span>
    </div>
    <div class="mfd-readouts">
      <div><span>Altitude</span><b data-r="alt"></b></div>
      <div><span>Speed</span><b data-r="spd"></b></div>
      <div><span>Decel</span><b data-r="g"></b></div>
      <div><span>Dyn. pressure</span><b data-r="qd"></b></div>
    </div>
    <div class="mfd-bars">
      <div><span class="lab"><span data-r="hfLab"></span><span class="lim" data-r="hfLim"></span></span><span class="bar"><i data-r="hfBar"></i></span></div>
      <div><span class="lab"><span data-r="gLab"></span><span class="lim" data-r="gLim"></span></span><span class="bar"><i data-r="gBar"></i></span></div>
    </div>
    <ol class="mfd-events" data-r="events"></ol>
  </aside>
  <footer class="ride-foot">
    <button class="play big" type="button" data-r="play" aria-label="Play">${PLAY}</button>
    <div class="ride-track">
      <span class="heat" data-r="heat"></span>
      <span data-r="ticks"></span>
      <label class="sr" for="rideScrub">Playback time</label>
      <input type="range" id="rideScrub" min="0" max="1000" step="1" value="0" data-r="scrub">
    </div>
    <label class="speed"><span class="sr">Playback speed</span><select data-r="speed">${SPEEDS.map((s) => `<option value="${s}">${s}×</option>`).join('')}</select></label>
    <button class="btn" type="button" aria-pressed="false" data-r="sound">${SOUND_OFF}<span>Turn on sound</span></button>
    <p class="ride-about">Sound is made live from this run: roar follows dynamic pressure, hiss follows heat flux, rumble follows g, and each parachute opens with a thump. Headphones help.</p>
  </footer>`;

let root, R = {};
let openNow = false;
const sound = new EntrySound();
let shownResult = null, last = { chute: 0, alt: Infinity }, lastDraw = 0, turbFreq = '', dragging = false;

export const isRideOpen = () => openNow;

export function buildRide(el) {
  root = el;
  root.innerHTML = TEMPLATE;
  root.querySelectorAll('[data-r]').forEach((n) => (R[n.dataset.r] = n));
  R.close.addEventListener('click', closeRide);
  R.play.addEventListener('click', () => setPlaying(!store.playing));
  // Only hold the thumb still while it is being dragged; a click must not stop it following playback.
  R.scrub.addEventListener('pointerdown', () => (dragging = true));
  window.addEventListener('pointerup', () => (dragging = false));
  R.scrub.addEventListener('input', () => {
    if (!store.result) return;
    const s = store.result.samples.t;
    emit('seek', (Number(R.scrub.value) / 1000) * s[s.length - 1]);
  });
  R.speed.addEventListener('change', () => {
    store.speed = Number(R.speed.value);
    const main = document.getElementById('speedSel');
    if (main) main.value = R.speed.value;
  });
  R.sound.addEventListener('click', () => {
    const on = sound.toggle();
    R.sound.setAttribute('aria-pressed', String(on));
    R.sound.innerHTML = `${on ? SOUND_ON : SOUND_OFF}<span>${on ? 'Sound on' : 'Turn on sound'}</span>`;
  });
}

export function openRide() {
  root.hidden = false;
  openNow = true;
  R.speed.value = String(store.speed);
  sound.resume();
  lastDraw = 0;
  R.close.focus();
}

export function closeRide() {
  root.hidden = true;
  openNow = false;
  sound.pause();
  document.getElementById('rideBtn')?.focus();
}

// Called every animation frame while the view is open.
export function updateRide(s, result, now) {
  if (!openNow || !s || !result) return;
  const sum = result.summary, P = result.params, planet = P.planet;
  if (result !== shownResult) newRun(result);
  const peaks = { q: Math.max(sum.peakHeatFlux, 1), qDyn: Math.max(sum.peakDynamicPressure, 1), g: Math.max(sum.peakG, 0.1) };
  const alt = s.alt / 1000, v = s.vRel / 1000;
  const dn = Math.min(1, s.qDyn / peaks.qDyn), gn = Math.min(1, s.g / peaks.g);
  const stage = Math.round(s.chute || 0);
  const down = alt < 0.001;

  // Sound and parachute/touchdown thumps run every frame; thumps only when time moves forward.
  sound.update(s, peaks, store.playing);
  if (store.playing && stage > last.chute) sound.thump(stage === 2 ? 0.8 : 0.6);
  if (store.playing && down && last.alt >= 0.001) sound.thump(1);
  last = { chute: stage, alt };

  // Shake every frame while playing; the rest of the picture ~30 times a second.
  const shake = store.playing && !down ? 2 + 9 * Math.pow(dn, 0.8) + 4 * gn : 0;
  const jx = (Math.random() - 0.5) * shake, jy = (Math.random() - 0.5) * shake;
  const swing = stage > 0 && !down ? Math.sin(now / 1000 * 1.3) * 6 : 0;
  const low = sstep(30, 2, alt);
  const tilt = down ? -2 : stage > 0 ? -14 + swing * 0.6 : -14 + Math.sin(now / 1000 * 0.7) * 1.5 * (1 - low);
  R.outside.setAttribute('transform', `translate(${jx.toFixed(2)} ${jy.toFixed(2)}) rotate(${tilt.toFixed(2)} 300 300)`);
  R.porthole.style.transform = `translate(${(jx * 0.25).toFixed(2)}px, ${(jy * 0.25).toFixed(2)}px)`;
  if (now - lastDraw < 33) return;
  lastDraw = now;

  // Sky, horizon and clouds
  const [top, hor] = sky(planet, alt);
  R.skyTop.setAttribute('stop-color', rgb(top));
  R.skyHor.setAttribute('stop-color', rgb(hor));
  const limbR = 300 + 60000 / (alt + 2), hy = 300 + 0.28 * Math.min(alt, 120);
  const g = GROUND[planet] || GROUND.earth;
  for (const n of [R.ground, R.groundGrad]) { n.setAttribute('cy', (hy + limbR).toFixed(0)); n.setAttribute('r', limbR.toFixed(0)); }
  R.groundA.setAttribute('stop-color', rgb(mixC(g.hi[0], g.lo[0], low)));
  R.groundB.setAttribute('stop-color', rgb(mixC(g.hi[1], g.lo[1], low)));
  R.groundC.setAttribute('stop-color', rgb(hor));
  R.stars.setAttribute('opacity', sstep(40, 90, alt).toFixed(2));
  const freq = planet === 'mars' ? '0.004' : (0.022 - 0.018 * low).toFixed(3);
  if (freq !== turbFreq) { R.turb.setAttribute('baseFrequency', freq); turbFreq = freq; }
  R.clouds.setAttribute('y', hy.toFixed(0));
  R.clouds.setAttribute('opacity', (planet === 'mars' ? 0.18 * (1 - low) : 0.64 - 0.3 * low).toFixed(2));
  R.puffs.style.display = planet === 'earth' && stage > 0 && !down && alt < 8 && alt > 0.6 ? '' : 'none';

  // Parachute: drogues are small and white; the main (or a single chute) is big and orange.
  R.chute.style.display = stage > 0 && !down ? '' : 'none';
  if (stage > 0) {
    const big = stage === 2 || !(P.vehicle.chute.drogueArea > 0);
    // Canopy across the top of the window, lines running down out of view toward the vehicle.
    const [L, Rx, base, dome, lip] = big ? [50, 550, 160, -40, 110] : [205, 395, 120, 30, 100];
    R.chute.setAttribute('transform', `rotate(${swing.toFixed(2)} 300 700)`);
    R.risers.setAttribute('d', `M${L} ${base} L300 760 M${Rx} ${base} L300 760 M300 ${lip} L300 760`);
    R.canopy.setAttribute('d', `M${L} ${base} Q300 ${dome} ${Rx} ${base} Q300 ${lip} ${L} ${base} Z`);
    R.canopy.setAttribute('fill', big ? '#ff7a35' : '#eef1f4');
    R.gores.setAttribute('d', `M${L} ${base} Q300 ${dome} ${Rx} ${base}`);
    R.gores.setAttribute('stroke', big ? '#ffffff' : '#ff7a35');
  }

  // Plasma: same brightness scale as the vehicle camera (log heat flux), so tiny probes still glow.
  const glow = clamp((Math.log10(Math.max(s.q, 0.1)) - 0.3) / 2.2, 0, 1);
  R.plasma.setAttribute('opacity', glow.toFixed(3));
  R.tint.setAttribute('opacity', (0.16 * glow).toFixed(3));
  R.note.textContent = down ? 'Touchdown' : `Altitude ${alt.toFixed(1)} km`;

  // Instruments
  const ph = phase(s, result);
  R.clock.textContent = `T+${clock(s.t)}`;
  R.phase.textContent = ph;
  R.phase.style.color = /chute|Drogue/.test(ph) ? 'var(--warn)' : ph === 'Landed' ? 'var(--good)' : ph === 'Peak heating' ? 'var(--accent)' : 'var(--focus)';
  R.blackout.hidden = !(alt < 95 && alt > 35 && v > 4 && s.q > 0.08 * peaks.q);
  R.alt.innerHTML = `${alt >= 10 ? alt.toFixed(1) : alt.toFixed(2)}<small>km</small>`;
  R.spd.innerHTML = v >= 1 ? `${v.toFixed(2)}<small>km/s</small>` : `${Math.round(s.vRel)}<small>m/s</small>`;
  R.g.innerHTML = `${s.g.toFixed(2)}<small>g</small>`;
  R.g.classList.toggle('hot', s.g > 0.8 * P.limits.gLoad);
  R.qd.innerHTML = `${sig(s.qDyn / 1000, 3)}<small>kPa</small>`;
  R.hfLab.textContent = `Heat flux · ${sig(s.q, 3)} W/cm²`;
  R.hfLim.textContent = `limit ${sig(P.limits.heatFlux)}`;
  R.hfBar.style.width = `${clamp((s.q / P.limits.heatFlux) * 100, 0, 100)}%`;
  R.hfBar.style.background = heatCss(heatScale(peaks.q)(s.q));
  R.gLab.textContent = `Deceleration · ${s.g.toFixed(2)} g`;
  R.gLim.textContent = `limit ${sig(P.limits.gLoad)} g`;
  R.gBar.style.width = `${clamp((s.g / P.limits.gLoad) * 100, 0, 100)}%`;
  R.gBar.style.background = s.g > 0.8 * P.limits.gLoad ? 'var(--crit)' : 'var(--warn)';
  let cur = -1;
  result.events.forEach((e, i) => { if (e.t <= s.t + 1e-6) cur = i; });
  R.events.querySelectorAll('li').forEach((li, i) => { li.dataset.s = i < cur ? 'done' : i === cur ? 'now' : 'next'; });

  // Controls
  const T = result.samples.t[result.samples.t.length - 1];
  if (!dragging) R.scrub.value = String(Math.round((s.t / T) * 1000));
  const playing = String(store.playing);
  if (R.play.dataset.playing !== playing) {
    R.play.dataset.playing = playing;
    R.play.innerHTML = store.playing ? PAUSE : PLAY;
    R.play.setAttribute('aria-label', store.playing ? 'Pause' : 'Play');
  }
}

// A new run: rebuild the event list, the heat strip and the event ticks.
function newRun(result) {
  shownResult = result;
  last = { chute: 0, alt: Infinity };
  const s = result.samples, T = s.t[s.t.length - 1], hs = heatScale(Math.max(result.summary.peakHeatFlux, 1));
  R.mission.textContent = document.querySelector('#presetBtn b')?.textContent || '';
  R.events.innerHTML = result.events.map((e) => `<li><i></i><span>${escapeHtml(e.label)}</span><time>T+${clock(e.t)}</time></li>`).join('');
  const stops = [];
  for (let k = 0, i = 0; k <= 40; k++) {
    const t = (T * k) / 40;
    while (i < s.t.length - 1 && s.t[i] < t) i++;
    stops.push(`${heatCss(hs(s.q[i]))} ${(k * 2.5).toFixed(1)}%`);
  }
  R.heat.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
  R.ticks.innerHTML = result.events.filter((e) => e.type !== 'entry').map((e) => `<span class="tick" style="left:${((e.t / T) * 100).toFixed(2)}%" title="${escapeHtml(e.label)}"></span>`).join('');
}
