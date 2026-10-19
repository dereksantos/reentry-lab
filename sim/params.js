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
  { path: 'entry.alt', label: 'Entry altitude', group: 'entry', unit: 'km', scale: 1e-3, min: 80000, max: 1000000, step: 1000, desc: 'Where the run starts. The air starts to matter around 100–120 km; a few hundred km is a low orbit.' },
  { path: 'entry.speed', label: 'Entry speed (inertial)', group: 'entry', unit: 'km/s', scale: 1e-3, min: 2000, max: 16000, step: 50 },
  { path: 'entry.fpa', label: 'Flight-path angle', group: 'entry', unit: '°', min: -45, max: 5, step: 0.05, desc: 'Inertial flight-path angle at the start. Negative is downward; 0 is level, as in a circular orbit.' },
  { path: 'entry.azimuth', label: 'Heading', group: 'entry', unit: '°', min: 0, max: 360, step: 1, desc: 'Degrees clockwise from north.' },
  { path: 'entry.lat', label: 'Latitude', group: 'entry', unit: '°', min: -89, max: 89, step: 0.1 },
  { path: 'entry.lon', label: 'Longitude', group: 'entry', unit: '°', min: -180, max: 180, step: 0.1 },

  // Electric thruster (solar-electric propulsion)
  { path: 'vehicle.thruster.enabled', label: 'Electric thruster', group: 'thruster', type: 'bool', desc: 'An ion or Hall thruster powered by solar panels. It needs propellant to push out the back; electricity just throws it very fast.' },
  { path: 'vehicle.thruster.power', label: 'Electric power', group: 'thruster', unit: 'kW', scale: 1e-3, min: 100, max: 5000000, log: true, desc: 'From the solar panels. Real spacecraft: Dawn 2.3 kW, Psyche 4.5 kW; the space station arrays make about 100 kW.' },
  { path: 'vehicle.thruster.efficiency', label: 'Thruster efficiency', group: 'thruster', unit: '', min: 0.1, max: 0.9, step: 0.01, desc: 'Share of the electric power that ends up in the exhaust jet. Ion and Hall thrusters reach about 0.5–0.7.' },
  { path: 'vehicle.thruster.exhaustSpeed', label: 'Exhaust speed', group: 'thruster', unit: 'km/s', scale: 1e-3, min: 2000, max: 80000, step: 500, desc: 'Faster exhaust saves propellant but gives less thrust for the same power. Hall thrusters about 15–20 km/s, ion thrusters 30–40 km/s; chemical rockets 3–4.5 km/s.' },
  { path: 'vehicle.thruster.propellant', label: 'Propellant', group: 'thruster', unit: 'kg', min: 0.1, max: 50000, log: true, desc: 'Xenon or krypton gas. Counted in the vehicle mass above.' },
  { path: 'vehicle.thruster.direction', label: 'Thrust direction', group: 'thruster', type: 'enum', options: ['retrograde', 'prograde'], desc: 'retrograde: against the motion, to slow down and lower the orbit. prograde: with it, to speed up and raise it.' },
  { path: 'vehicle.thruster.cutoffAlt', label: 'Stop thrusting below', group: 'thruster', unit: 'km', scale: 1e-3, min: 0, max: 1000000, step: 5000, desc: 'The thruster switches off once the vehicle is this low, before the air gets thick.' },

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

  // Fictional technology (game): no known physics does this
  { path: 'vehicle.antigrav.factor', label: 'Antigravity: gravity cancelled', group: 'fiction', unit: '', min: 0, max: 1, step: 0.01, desc: 'Fictional: share of gravity a made-up antigravity plate cancels. 0 is off; 1 would make the vehicle float.' },
  { path: 'vehicle.antigrav.startAlt', label: 'Antigravity switches on below', group: 'fiction', unit: 'km', scale: 1e-3, min: 0, max: 200000, step: 1000 },

  // Limits
  { path: 'limits.heatFlux', label: 'Heat shield limit', group: 'limits', unit: 'W/cm²', min: 5, max: 5000, log: true },
  { path: 'limits.heatLoad', label: 'Heat load limit', group: 'limits', unit: 'kJ/cm²', scale: 1e-3, min: 1000, max: 200000, log: true, desc: 'Total energy per area the shield can absorb at the nose.' },
  { path: 'limits.gLoad', label: 'Crew g limit', group: 'limits', unit: 'g', min: 1, max: 100, step: 0.5 },
  { path: 'limits.landingSpeed', label: 'Max landing speed', group: 'limits', unit: 'm/s', min: 1, max: 100, step: 0.5 },

  // Numerics
  { path: 'sim.maxTime', label: 'Max simulated time', group: 'numerics', unit: 's', min: 300, max: 604800, log: true, desc: 'Up to 7 days (604800 s), for slow electric-thruster orbit changes.' },
  { path: 'sim.rtol', label: 'Integrator tolerance', group: 'numerics', unit: '', min: 1e-12, max: 1e-5, log: true }
];

export const DEFAULTS = {
  planet: 'earth',
  environment: { densityScale: 1 },
  vehicle: {
    shape: 'capsule', mass: 2900, refArea: 3.8, cd: 1.3, noseRadius: 2.2, liftToDrag: 0.3, emissivity: 0.85,
    chute: { enabled: true, deployAlt: 9000, drogueArea: 24, drogueCd: 0.6, mainAlt: 7000, area: 1000, cd: 0.8, maxMach: 0.9, fillTime: 6 },
    mhd: { factor: 0, efficiency: 0.3 },
    thruster: { enabled: false, power: 5000, efficiency: 0.6, exhaustSpeed: 20000, propellant: 100, direction: 'retrograde', cutoffAlt: 120000 },
    antigrav: { factor: 0, startAlt: 40000 }
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
