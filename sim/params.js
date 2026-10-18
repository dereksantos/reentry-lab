// Parameter schema shared by the simulator, the CLI and the UI.
// Values are stored in SI units (m, kg, s, m/s). `display` says how the UI and CLI show them.

export const PARAMS = [
  // World
  { path: 'planet', label: 'Planet', group: 'world', type: 'enum', options: ['earth', 'mars'] },
  { path: 'environment.densityScale', label: 'Air density multiplier', group: 'world', unit: '×', min: 0.1, max: 10, log: true, desc: 'Scales the whole atmosphere density profile. Useful for dispersions and "what if" studies.' },

  // Vehicle
  { path: 'vehicle.shape', label: 'Body shape (3D only)', group: 'vehicle', type: 'enum', options: ['capsule', 'glider', 'probe', 'inflatable'] },
  { path: 'vehicle.mass', label: 'Mass', group: 'vehicle', unit: 'kg', min: 10, max: 200000, log: true },
  { path: 'vehicle.refArea', label: 'Reference area', group: 'vehicle', unit: 'm²', min: 0.05, max: 1000, log: true, desc: 'Area the drag coefficient is referenced to, usually the frontal area.' },
  { path: 'vehicle.cd', label: 'Drag coefficient', group: 'vehicle', unit: '', min: 0.2, max: 2.5, step: 0.01, desc: 'Hypersonic drag coefficient, held constant.' },
  { path: 'vehicle.noseRadius', label: 'Nose radius', group: 'vehicle', unit: 'm', min: 0.05, max: 15, log: true, desc: 'Effective radius at the stagnation point. Blunter means lower heating.' },
  { path: 'vehicle.liftToDrag', label: 'Lift-to-drag ratio', group: 'vehicle', unit: '', min: 0, max: 2, step: 0.01 },
  { path: 'vehicle.emissivity', label: 'Surface emissivity', group: 'vehicle', unit: '', min: 0.3, max: 1, step: 0.01, desc: 'Sets the radiative-equilibrium wall temperature.' },

  // Guidance
  { path: 'guidance.mode', label: 'Bank control', group: 'guidance', type: 'enum', options: ['constant', 'reversal', 'spin'], desc: 'constant: fixed bank angle. reversal: bank flips side every period (S-turns). spin: rolling so lift averages to zero (ballistic).' },
  { path: 'guidance.bank', label: 'Bank angle', group: 'guidance', unit: '°', min: 0, max: 180, step: 1, desc: '0° points all lift up, 90° sideways, 180° down.' },
  { path: 'guidance.reversalPeriod', label: 'Reversal period', group: 'guidance', unit: 's', min: 30, max: 900, step: 10 },

  // Entry interface
  { path: 'entry.alt', label: 'Entry altitude', group: 'entry', unit: 'km', scale: 1e-3, min: 80000, max: 200000, step: 1000 },
  { path: 'entry.speed', label: 'Entry speed (inertial)', group: 'entry', unit: 'km/s', scale: 1e-3, min: 2000, max: 16000, step: 50 },
  { path: 'entry.fpa', label: 'Flight-path angle', group: 'entry', unit: '°', min: -45, max: -0.2, step: 0.05, desc: 'Inertial flight-path angle at entry interface. Negative is downward.' },
  { path: 'entry.azimuth', label: 'Heading', group: 'entry', unit: '°', min: 0, max: 360, step: 1, desc: 'Degrees clockwise from north.' },
  { path: 'entry.lat', label: 'Latitude', group: 'entry', unit: '°', min: -89, max: 89, step: 0.1 },
  { path: 'entry.lon', label: 'Longitude', group: 'entry', unit: '°', min: -180, max: 180, step: 0.1 },

  // Parachute
  { path: 'vehicle.chute.enabled', label: 'Parachute', group: 'chute', type: 'bool' },
  { path: 'vehicle.chute.deployAlt', label: 'First chute altitude', group: 'chute', unit: 'km', scale: 1e-3, min: 500, max: 20000, step: 100, desc: 'Drogue deploys here (or the main, if there is no drogue).' },
  { path: 'vehicle.chute.drogueArea', label: 'Drogue area', group: 'chute', unit: 'm²', min: 0, max: 200, step: 1, desc: 'Set to 0 for a single-stage parachute.' },
  { path: 'vehicle.chute.drogueCd', label: 'Drogue drag coefficient', group: 'chute', unit: '', min: 0.3, max: 1.2, step: 0.01 },
  { path: 'vehicle.chute.mainAlt', label: 'Main chute altitude', group: 'chute', unit: 'km', scale: 1e-3, min: 300, max: 15000, step: 100 },
  { path: 'vehicle.chute.area', label: 'Main canopy area', group: 'chute', unit: 'm²', min: 1, max: 3000, log: true },
  { path: 'vehicle.chute.cd', label: 'Main drag coefficient', group: 'chute', unit: '', min: 0.3, max: 1.2, step: 0.01 },
  { path: 'vehicle.chute.fillTime', label: 'Canopy fill time', group: 'chute', unit: 's', min: 0.5, max: 20, step: 0.5, desc: 'Time for a canopy to inflate fully. Longer fills soften the opening shock.' },
  { path: 'vehicle.chute.maxMach', label: 'Max safe first-chute Mach', group: 'chute', unit: '', min: 0.2, max: 3, step: 0.05 },

  // Magnetic braking (speculative)
  { path: 'vehicle.mhd.factor', label: 'Magnetic drag (× aero drag)', group: 'mhd', unit: '×', min: 0, max: 5, step: 0.1, desc: 'Toy model: extra braking from a magnetic field acting on ionized flow, ramping in from 3 to 5 km/s.' },
  { path: 'vehicle.mhd.efficiency', label: 'Share turned into electricity', group: 'mhd', unit: '', min: 0, max: 0.8, step: 0.05 },

  // Limits
  { path: 'limits.heatFlux', label: 'Heat shield limit', group: 'limits', unit: 'W/cm²', min: 5, max: 5000, log: true },
  { path: 'limits.heatLoad', label: 'Heat load limit', group: 'limits', unit: 'kJ/cm²', scale: 1e-3, min: 1000, max: 200000, log: true, desc: 'Total energy per area the shield can absorb at the nose.' },
  { path: 'limits.gLoad', label: 'Crew g limit', group: 'limits', unit: 'g', min: 1, max: 100, step: 0.5 },
  { path: 'limits.landingSpeed', label: 'Max landing speed', group: 'limits', unit: 'm/s', min: 1, max: 100, step: 0.5 },

  // Numerics
  { path: 'sim.maxTime', label: 'Max simulated time', group: 'numerics', unit: 's', min: 300, max: 14400, step: 60 },
  { path: 'sim.rtol', label: 'Integrator tolerance', group: 'numerics', unit: '', min: 1e-12, max: 1e-5, log: true }
];

export const DEFAULTS = {
  planet: 'earth',
  environment: { densityScale: 1 },
  vehicle: {
    shape: 'capsule', mass: 2900, refArea: 3.8, cd: 1.3, noseRadius: 2.2, liftToDrag: 0.3, emissivity: 0.85,
    chute: { enabled: true, deployAlt: 9000, drogueArea: 24, drogueCd: 0.6, mainAlt: 7000, area: 1000, cd: 0.8, maxMach: 0.9, fillTime: 6 },
    mhd: { factor: 0, efficiency: 0.3 }
  },
  guidance: { mode: 'constant', bank: 50, reversalPeriod: 240 },
  entry: { alt: 120000, speed: 7800, fpa: -1.4, azimuth: 60, lat: 30, lon: 20 },
  limits: { heatFlux: 300, heatLoad: 40000, gLoad: 8, landingSpeed: 10 },
  sim: { maxTime: 3600, rtol: 1e-8 }
};

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
export function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object') out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}
export const clone = (o) => JSON.parse(JSON.stringify(o));

// Parse a CLI/agent "key=value" assignment, accepting display units (km, km/s) as the schema declares them.
export function parseAssignment(text) {
  const i = text.indexOf('=');
  if (i < 0) throw new Error(`Expected key=value, got "${text}"`);
  const path = text.slice(0, i).trim();
  const raw = text.slice(i + 1).trim();
  const meta = PARAMS.find((p) => p.path === path);
  if (!meta) throw new Error(`Unknown parameter "${path}". Run "node sim/cli.js describe" to list them.`);
  let value;
  if (meta.type === 'enum') {
    if (!meta.options.includes(raw)) throw new Error(`${path} must be one of: ${meta.options.join(', ')}`);
    value = raw;
  } else if (meta.type === 'bool') {
    value = ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${path} needs a number, got "${raw}"`);
    value = meta.scale ? n / meta.scale : n;
  }
  return { path, value, meta };
}

export function displayValue(meta, value) {
  if (meta.type) return value;
  return meta.scale ? value * meta.scale : value;
}
