// Physical constants and planet definitions.
// Sources: WGS84 (Earth shape, GM, rotation), IAU/NASA fact sheets (Mars).

export const G0 = 9.80665;            // standard gravity, m/s^2 (used for g-load in Earth g)
export const SIGMA = 5.670374419e-8;  // Stefan–Boltzmann, W/m^2/K^4

export const PLANETS = {
  earth: {
    id: 'earth',
    name: 'Earth',
    mu: 3.986004418e14,       // m^3/s^2 (WGS84)
    Req: 6378137.0,           // equatorial radius, m (WGS84)
    f: 1 / 298.257223563,     // flattening (WGS84)
    J2: 1.08262668e-3,
    omega: 7.2921159e-5,      // rotation rate, rad/s
    atmosphere: 'us76',
    suttonGravesK: 1.7415e-4, // kg^0.5/m, convective stagnation heating constant for air
    radiative: 'tauber-sutton-earth',
    meanRadius: 6371008.8
  },
  mars: {
    id: 'mars',
    name: 'Mars',
    mu: 4.282837e13,
    Req: 3396190.0,
    f: 1 / 169.894,
    J2: 1.96045e-3,
    omega: 7.088218e-5,
    atmosphere: 'mars-simple',
    suttonGravesK: 1.9027e-4, // CO2-dominated atmosphere
    radiative: 'none',
    meanRadius: 3389500.0
  }
};

export function planet(id) {
  const p = PLANETS[id];
  if (!p) throw new Error(`Unknown planet "${id}". Options: ${Object.keys(PLANETS).join(', ')}`);
  return p;
}
