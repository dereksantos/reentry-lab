// Vehicle and mission presets. These are "inspired by" real missions and use rounded public figures;
// they are starting points for study, not reconstructions of flown trajectories.
import { DEFAULTS, deepMerge } from './params.js';

const P = (key, name, summary, over) => ({ key, name, summary, params: deepMerge(DEFAULTS, over) });

export const PRESETS = [
  P('leo-capsule', 'Low-orbit capsule', 'Soyuz-class crew capsule returning from low Earth orbit with a lifting, banked entry.', {
    vehicle: { shape: 'capsule', mass: 2900, refArea: 3.8, cd: 1.3, noseRadius: 2.2, liftToDrag: 0.3,
      chute: { enabled: true, deployAlt: 9500, drogueArea: 24, drogueCd: 0.6, mainAlt: 7500, area: 1000, cd: 0.8, maxMach: 0.9, fillTime: 8 } },
    guidance: { mode: 'constant', bank: 50 },
    entry: { alt: 120000, speed: 7800, fpa: -1.4, azimuth: 60, lat: 30, lon: 20 },
    limits: { heatFlux: 300, heatLoad: 40000, gLoad: 8, landingSpeed: 10 }
  }),
  P('lunar-return', 'Moon-return capsule', 'Apollo-class command module coming back from the Moon at about 11 km/s.', {
    vehicle: { shape: 'capsule', mass: 5400, refArea: 12.0, cd: 1.3, noseRadius: 4.7, liftToDrag: 0.3,
      chute: { enabled: true, deployAlt: 7300, drogueArea: 40, drogueCd: 0.6, mainAlt: 3000, area: 1500, cd: 0.8, maxMach: 0.9, fillTime: 8 } },
    guidance: { mode: 'constant', bank: 45 },
    entry: { alt: 121900, speed: 11000, fpa: -6.5, azimuth: 45, lat: 0, lon: -175 },
    limits: { heatFlux: 600, heatLoad: 60000, gLoad: 10, landingSpeed: 10 }
  }),
  P('winged-glider', 'Winged glider', 'Shuttle-class orbiter flying a high-lift entry with S-turn bank reversals.', {
    vehicle: { shape: 'glider', mass: 95000, refArea: 250, cd: 0.85, noseRadius: 1.3, liftToDrag: 1.0,
      chute: { enabled: false } },
    guidance: { mode: 'reversal', bank: 45, reversalPeriod: 300 },
    entry: { alt: 122000, speed: 7750, fpa: -1.2, azimuth: 60, lat: 0, lon: -150 },
    limits: { heatFlux: 100, heatLoad: 60000, gLoad: 3, landingSpeed: 100 }
  }),
  P('sample-return', 'Fast sample return', 'Stardust-class small capsule: the fastest kind of Earth entry, with strong radiative heating.', {
    vehicle: { shape: 'probe', mass: 45.8, refArea: 0.5166, cd: 1.48, noseRadius: 0.22, liftToDrag: 0,
      chute: { enabled: true, deployAlt: 30000, drogueArea: 0.75, drogueCd: 0.6, mainAlt: 3000, area: 52.8, cd: 0.8, maxMach: 1.6, fillTime: 3 } },
    guidance: { mode: 'spin', bank: 0 },
    entry: { alt: 125000, speed: 12900, fpa: -8.2, azimuth: 100, lat: 41.5, lon: -126 },
    limits: { heatFlux: 1500, heatLoad: 40000, gLoad: 60, landingSpeed: 10 }
  }),
  P('inflatable', 'Inflatable decelerator', 'Very low ballistic coefficient: a large inflatable aeroshell that brakes high in thin air.', {
    vehicle: { shape: 'inflatable', mass: 1500, refArea: 113, cd: 1.4, noseRadius: 6, liftToDrag: 0,
      chute: { enabled: false } },
    guidance: { mode: 'spin', bank: 0 },
    entry: { alt: 120000, speed: 7800, fpa: -1.5, azimuth: 60, lat: 30, lon: 20 },
    limits: { heatFlux: 50, heatLoad: 5000, gLoad: 12, landingSpeed: 15 }
  }),
  P('ballistic-probe', 'Dense ballistic probe', 'Small, heavy, non-lifting body entering steeply. Brutal heating and deceleration.', {
    vehicle: { shape: 'probe', mass: 400, refArea: 0.5, cd: 1.0, noseRadius: 0.4, liftToDrag: 0,
      chute: { enabled: false } },
    guidance: { mode: 'spin', bank: 0 },
    entry: { alt: 120000, speed: 7800, fpa: -15, azimuth: 60, lat: 30, lon: 20 },
    limits: { heatFlux: 2000, heatLoad: 40000, gLoad: 100, landingSpeed: 300 }
  }),
  P('magnetic-braking', 'Capsule with magnetic braking', 'The low-orbit capsule plus a speculative magnetic brake that pulls energy from the plasma.', {
    vehicle: { shape: 'capsule', mass: 2900, refArea: 3.8, cd: 1.3, noseRadius: 2.2, liftToDrag: 0.3,
      chute: { enabled: true, deployAlt: 9500, drogueArea: 24, drogueCd: 0.6, mainAlt: 7500, area: 1000, cd: 0.8, maxMach: 0.9, fillTime: 8 },
      mhd: { factor: 2, efficiency: 0.3 } },
    guidance: { mode: 'constant', bank: 50 },
    entry: { alt: 120000, speed: 7800, fpa: -1.4, azimuth: 60, lat: 30, lon: 20 },
    limits: { heatFlux: 300, heatLoad: 40000, gLoad: 8, landingSpeed: 10 }
  }),
  P('mars-lander', 'Mars lander', 'MSL-class guided entry at Mars with a supersonic parachute.', {
    planet: 'mars',
    vehicle: { shape: 'capsule', mass: 3300, refArea: 15.9, cd: 1.68, noseRadius: 1.125, liftToDrag: 0.24,
      chute: { enabled: true, deployAlt: 10000, drogueArea: 0, mainAlt: 10000, area: 363, cd: 0.6, maxMach: 2.2, fillTime: 1.5 } },
    guidance: { mode: 'constant', bank: 40 },
    entry: { alt: 125000, speed: 5850, fpa: -15.5, azimuth: 100, lat: -3.0, lon: 126.0 },
    limits: { heatFlux: 200, heatLoad: 10000, gLoad: 15, landingSpeed: 1 }
  })
];

export function preset(key) {
  const p = PRESETS.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown preset "${key}". Options: ${PRESETS.map((x) => x.key).join(', ')}`);
  return p;
}
