// Campaign contracts. Each one starts from a preset, fixes most of the vehicle, and leaves a few knobs for the
// player. "goal" must pass to complete the contract; each passed "bonus" adds a star (up to 3 in all).
// Objectives read the run's summary, so they use the simulator's real numbers.
import { PRESETS, clone, deepMerge, setPath } from '../../sim/index.js';
import { applyUpgrades } from './upgrades.js';

const R_EARTH_KM = 6371;
// Great-circle distance in km between the landing point and a target.
export function distanceKm(lat1, lon1, lat2, lon2) {
  const d = Math.PI / 180, a = Math.sin(((lat2 - lat1) * d) / 2) ** 2 + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(((lon2 - lon1) * d) / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
const landed = (s) => s.outcome === 'landed';
const miss = (s, m) => (landed(s) && m.target ? distanceKm(s.landingLat, s.landingLon, m.target.lat, m.target.lon) : Infinity);
const fmtKm = (km) => (km === Infinity ? 'no landing' : `${Math.round(km)} km off`);

export const MISSIONS = [
  {
    id: 'first-light', title: 'First Light', level: 'Training', reward: 120, base: 'leo-capsule',
    brief: 'Your first capsule is coming home from orbit, but the entry angle is too shallow: it will bounce off the atmosphere. Steepen it and bring it down.',
    over: { entry: { fpa: -0.3, speed: 7900 }, guidance: { mode: 'constant', bank: 0 } },
    knobs: ['entry.fpa'],
    goal: [{ label: 'Land the capsule', test: (s) => landed(s), show: (s) => (landed(s) ? 'landed' : s.outcome) }],
    bonus: [
      { label: 'Peak g under 6', test: (s) => landed(s) && s.peakG < 6, show: (s) => `${s.peakG.toFixed(1)} g` },
      { label: 'Touch down under 8 m/s', test: (s) => landed(s) && s.landingSpeed < 8, show: (s) => (landed(s) ? `${s.landingSpeed.toFixed(1)} m/s` : '–') }
    ]
  },
  {
    id: 'gentle-hands', title: 'Gentle Hands', level: 'Easy', reward: 180, base: 'leo-capsule',
    brief: 'A crew is aboard and the flight surgeon wants it smooth. Use the entry angle and bank angle to keep the g-force down.',
    over: { entry: { fpa: -2.5 }, guidance: { mode: 'constant', bank: 70 } },
    knobs: ['entry.fpa', 'guidance.bank'],
    goal: [{ label: 'Land with peak g under 4', test: (s) => landed(s) && s.peakG < 4, show: (s) => `${s.peakG.toFixed(1)} g` }],
    bonus: [
      { label: 'Peak g under 3.3', test: (s) => landed(s) && s.peakG < 3.3, show: (s) => `${s.peakG.toFixed(2)} g` },
      { label: 'Heat soaked under 15 kJ/cm²', test: (s) => landed(s) && s.heatLoad < 15000, show: (s) => `${(s.heatLoad / 1000).toFixed(1)} kJ/cm²` }
    ]
  },
  {
    id: 'bullseye', title: 'Bullseye', level: 'Medium', reward: 250, base: 'leo-capsule',
    brief: 'The recovery team is waiting in the desert east of the Caspian Sea. Land close enough for a quick pickup. Entry angle sets how far you fly; bank angle trims it.',
    over: { entry: { fpa: -1.6 }, guidance: { mode: 'constant', bank: 50 } },
    target: { lat: 40.0, lon: 59.5, label: 'Recovery team' },
    knobs: ['entry.fpa', 'guidance.bank'],
    goal: [{ label: 'Land within 150 km of the team', test: (s, m) => miss(s, m) < 150, show: (s, m) => fmtKm(miss(s, m)) }],
    bonus: [
      { label: 'Within 40 km', test: (s, m) => miss(s, m) < 40, show: (s, m) => fmtKm(miss(s, m)) },
      { label: 'Within 10 km', test: (s, m) => miss(s, m) < 10, show: (s, m) => fmtKm(miss(s, m)) }
    ]
  },
  {
    id: 'moonshot', title: 'Moonshot Return', level: 'Hard', reward: 400, base: 'lunar-return', requires: 'shield2',
    brief: 'Coming back from the Moon at 11 km/s, and the planned angle is too steep: you’d cook the shield and the crew. Thread the corridor between burning up and skipping away.',
    over: { entry: { fpa: -7.5 } },
    knobs: ['entry.fpa', 'guidance.bank'],
    goal: [
      { label: 'Land', test: (s) => landed(s), show: (s) => (landed(s) ? 'landed' : s.outcome) },
      { label: 'Heat flux within your shield', test: (s) => s.checks.heatFlux.ok, show: (s) => `${Math.round(s.peakHeatFlux)} / ${Math.round(s.checks.heatFlux.limit)} W/cm²` },
      { label: 'Peak g under 10', test: (s) => s.peakG < 10, show: (s) => `${s.peakG.toFixed(1)} g` }
    ],
    bonus: [
      { label: 'Peak g under 7', test: (s) => landed(s) && s.peakG < 7, show: (s) => `${s.peakG.toFixed(1)} g` },
      { label: 'Heat soaked within your shield', test: (s) => landed(s) && s.checks.heatLoad.ok, show: (s) => `${(s.heatLoad / 1000).toFixed(1)} / ${(s.checks.heatLoad.limit / 1000).toFixed(0)} kJ/cm²` }
    ]
  },
  {
    id: 'skip-artist', title: 'Skip Artist', level: 'Expert', reward: 450, base: 'lunar-return', requires: 'shield2',
    brief: 'Apollo planners studied skipping off the atmosphere once to bleed speed and stretch the range. Do it on purpose: skip out, come back down, and land.',
    over: { entry: { fpa: -6.5 }, guidance: { mode: 'constant', bank: 0 } },
    knobs: ['entry.fpa', 'guidance.bank'],
    goal: [
      { label: 'Skip out of the atmosphere', test: (s) => s.skipped, show: (s) => (s.skipped ? 'skipped' : 'no skip') },
      { label: 'Then land', test: (s) => landed(s), show: (s) => (landed(s) ? 'landed' : s.outcome) },
      { label: 'Heat flux within your shield', test: (s) => s.checks.heatFlux.ok, show: (s) => `${Math.round(s.peakHeatFlux)} / ${Math.round(s.checks.heatFlux.limit)} W/cm²` }
    ],
    bonus: [
      { label: 'Peak g under 6', test: (s) => landed(s) && s.peakG < 6, show: (s) => `${s.peakG.toFixed(1)} g` },
      { label: 'Fly over 5,000 km downrange', test: (s) => landed(s) && s.downrange > 5e6, show: (s) => `${Math.round(s.downrange / 1000).toLocaleString('en-US')} km` }
    ]
  },
  {
    id: 'space-janitor', title: 'Space Janitor', level: 'Medium', reward: 400, base: 'electric-deorbit', requires: 'ion',
    brief: 'A dead satellite is clogging a 450 km orbit. Strap on the ion drive, push it down, and get it out of the sky fast.',
    over: { vehicle: { mass: 800, chute: { enabled: false }, thruster: { enabled: true, propellant: 200, direction: 'prograde', cutoffAlt: 120000 } }, entry: { alt: 450000, speed: 7640 }, sim: { maxTime: 86400 } },
    knobs: ['vehicle.thruster.direction', 'vehicle.thruster.cutoffAlt', 'vehicle.thruster.propellant'],
    goal: [{ label: 'Bring it down within a day', test: (s) => landed(s), show: (s) => (landed(s) ? `down in ${(s.flightTime / 3600).toFixed(1)} h` : 'still in orbit') }],
    bonus: [
      { label: 'Down within 2 hours', test: (s) => landed(s) && s.flightTime < 2 * 3600, show: (s) => (landed(s) ? `${(s.flightTime / 3600).toFixed(1)} h` : '–') },
      { label: 'Burn under 5 kg of xenon', test: (s) => landed(s) && s.thruster && s.thruster.propellantUsed < 5, show: (s) => (s.thruster ? `${s.thruster.propellantUsed.toFixed(1)} kg` : '–') }
    ]
  },
  {
    id: 'red-dust', title: 'Red Dust', level: 'Hard', reward: 500, base: 'mars-lander',
    brief: 'Bring the lander down over Gale Crater, where Curiosity landed. The supersonic parachute tears apart above Mach 2.2, so arrive slow enough to open it. (Real landers fire rockets for the last stretch; Mars air is too thin for a parachute alone.)',
    over: { entry: { fpa: -17 }, guidance: { mode: 'constant', bank: 60 } },
    target: { lat: -5.4, lon: 137.8, label: 'Gale Crater' },
    knobs: ['entry.fpa', 'guidance.bank', 'vehicle.chute.deployAlt'],
    goal: [
      { label: 'Parachute opens below Mach 2.2', test: (s) => s.chuteDeployMach != null && s.chuteDeployMach <= 2.2, show: (s) => (s.chuteDeployMach != null ? `Mach ${s.chuteDeployMach.toFixed(1)}` : 'never opened') },
      { label: 'Land within 100 km of Gale Crater', test: (s, m) => miss(s, m) < 100, show: (s, m) => fmtKm(miss(s, m)) }
    ],
    bonus: [
      { label: 'Within 25 km', test: (s, m) => miss(s, m) < 25, show: (s, m) => fmtKm(miss(s, m)) },
      { label: 'Peak g under 12', test: (s) => landed(s) && s.peakG < 12, show: (s) => `${s.peakG.toFixed(1)} g` }
    ]
  },
  {
    id: 'featherfall', title: 'Featherfall', level: 'Expert', reward: 600, base: 'leo-capsule', requires: 'antigrav',
    brief: 'No parachute this time. Use the antigravity plate to touch down slower than a jogger.',
    over: { vehicle: { chute: { enabled: false }, antigrav: { factor: 0.5, startAlt: 40000 } }, sim: { maxTime: 21600 } },
    knobs: ['vehicle.antigrav.factor', 'vehicle.antigrav.startAlt', 'entry.fpa'],
    goal: [{ label: 'Land under 15 m/s without a parachute', test: (s) => landed(s) && s.landingSpeed < 15, show: (s) => (landed(s) ? `${s.landingSpeed.toFixed(1)} m/s` : s.outcome) }],
    bonus: [
      { label: 'Under 5 m/s', test: (s) => landed(s) && s.landingSpeed < 5, show: (s) => (landed(s) ? `${s.landingSpeed.toFixed(1)} m/s` : '–') },
      { label: 'Peak g under 4', test: (s) => landed(s) && s.peakG < 4, show: (s) => `${s.peakG.toFixed(1)} g` }
    ]
  }
];

export const missionById = (id) => MISSIONS.find((m) => m.id === id);

// The params a mission starts with, given the owned upgrades. Knob values the player set can be passed in.
export function missionParams(mission, owned, knobValues = {}) {
  const preset = PRESETS.find((p) => p.key === mission.base);
  const p = applyUpgrades(deepMerge(clone(preset.params), mission.over || {}), owned);
  for (const [path, v] of Object.entries(knobValues)) setPath(p, path, v);
  return p;
}

// Score a finished run: which objectives passed, whether the contract is complete, and stars (1 + bonuses).
export function scoreRun(mission, summary) {
  const rate = (o) => ({ label: o.label, ok: !!safe(() => o.test(summary, mission)), value: safe(() => o.show(summary, mission)) ?? '' });
  const goal = mission.goal.map(rate), bonus = mission.bonus.map(rate);
  const complete = goal.every((g) => g.ok);
  return { goal, bonus, complete, stars: complete ? 1 + bonus.filter((b) => b.ok).length : 0 };
}
const safe = (f) => { try { return f(); } catch { return null; } };
