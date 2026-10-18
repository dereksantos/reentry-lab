// Atmosphere models. Each returns { rho (kg/m^3), T (K), P (Pa), a (speed of sound, m/s) }.

// ---------- U.S. Standard Atmosphere 1976 ----------
// 0–86 km: computed from the standard's layer definitions (geopotential altitude).
// 86–1000 km: tabulated density and kinetic temperature from the standard, log-interpolated.
const US76_R = 287.0531;     // J/(kg K), R* / M0
const US76_G0 = 9.80665;
const US76_R0 = 6356766;     // m, effective Earth radius used for geopotential altitude
const US76_GAMMA = 1.4;
const LAYERS = [
  // base geopotential altitude (m), base temperature (K), lapse rate (K/m)
  [0, 288.15, -0.0065],
  [11000, 216.65, 0.0],
  [20000, 216.65, 0.001],
  [32000, 228.65, 0.0028],
  [47000, 270.65, 0.0],
  [51000, 270.65, -0.0028],
  [71000, 214.65, -0.002],
  [84852, 186.946, 0.0]
];
// Precompute base pressures.
const BASE_P = [101325];
for (let i = 1; i < LAYERS.length; i++) {
  const [hb, Tb, L] = LAYERS[i - 1];
  const dh = LAYERS[i][0] - hb;
  const Pb = BASE_P[i - 1];
  if (L === 0) BASE_P.push(Pb * Math.exp(-US76_G0 * dh / (US76_R * Tb)));
  else BASE_P.push(Pb * Math.pow(Tb / (Tb + L * dh), US76_G0 / (US76_R * L)));
}
// km, density kg/m^3, kinetic temperature K
const UPPER = [
  [86, 6.958e-6, 186.87], [90, 3.416e-6, 186.87], [95, 1.393e-6, 188.42], [100, 5.604e-7, 195.08],
  [110, 9.708e-8, 240.0], [120, 2.222e-8, 360.0], [130, 8.152e-9, 469.27], [140, 3.831e-9, 559.63],
  [150, 2.076e-9, 634.39], [160, 1.233e-9, 696.29], [180, 5.194e-10, 790.07], [200, 2.541e-10, 854.56],
  [250, 6.073e-11, 941.33], [300, 1.916e-11, 976.01], [400, 2.803e-12, 995.83], [500, 5.215e-13, 999.24],
  [600, 1.137e-13, 999.85], [800, 1.136e-14, 999.99], [1000, 3.561e-15, 1000.0]
];

function us76Lower(z) {
  const h = US76_R0 * z / (US76_R0 + z); // geopotential altitude
  let i = 0;
  while (i < LAYERS.length - 1 && h >= LAYERS[i + 1][0]) i++;
  const [hb, Tb, L] = LAYERS[i];
  const Pb = BASE_P[i];
  const T = Tb + L * (h - hb);
  const P = L === 0 ? Pb * Math.exp(-US76_G0 * (h - hb) / (US76_R * Tb)) : Pb * Math.pow(Tb / T, US76_G0 / (US76_R * L));
  const rho = P / (US76_R * T);
  return { rho, T, P, a: Math.sqrt(US76_GAMMA * US76_R * T) };
}

function us76Upper(zkm) {
  if (zkm >= 1000) {
    const [h, r, T] = UPPER[UPPER.length - 1];
    const rho = r * Math.exp(-(zkm - h) / 300);
    return { rho, T, P: rho * US76_R * T, a: Math.sqrt(US76_GAMMA * US76_R * T) };
  }
  let i = 0;
  while (UPPER[i + 1][0] < zkm) i++;
  const [h1, r1, T1] = UPPER[i], [h2, r2, T2] = UPPER[i + 1];
  const s = (zkm - h1) / (h2 - h1);
  const rho = Math.exp(Math.log(r1) + s * (Math.log(r2) - Math.log(r1)));
  const T = T1 + s * (T2 - T1);
  // Above 86 km the gas composition changes; P and a here use sea-level air properties and are indicative only.
  return { rho, T, P: rho * US76_R * T, a: Math.sqrt(US76_GAMMA * US76_R * T) };
}

export function us76(altM) {
  const z = Math.max(altM, -5000);
  if (z < 86000) return us76Lower(z);
  return us76Upper(z / 1000);
}

// ---------- Simple Mars model ----------
// Below 30 km: NASA Glenn educational Mars model (fit to Mars Global Surveyor data).
// Above 30 km: exponential continuation with an 7.9 km scale height. Indicative only;
// real Mars density varies by season, dust and time of day by tens of percent or more.
const MARS_R = 188.92, MARS_GAMMA = 1.29;
const M30 = marsGlenn(30000);
function marsGlenn(h) {
  const Tc = h > 7000 ? -31 - 0.000998 * h : -23.4 - 0.00222 * h;
  const T = Math.max(130, Tc + 273.15);
  const PkPa = 0.699 * Math.exp(-0.00009 * h);
  const rho = PkPa / (0.1921 * T);
  return { rho, T, P: PkPa * 1000, a: Math.sqrt(MARS_GAMMA * MARS_R * T) };
}
export function marsSimple(altM) {
  const h = Math.max(altM, -8000);
  if (h <= 30000) return marsGlenn(h);
  const rho = M30.rho * Math.exp(-(h - 30000) / 7900);
  const T = Math.max(130, M30.T - 0.000998 * (h - 30000));
  return { rho, T, P: rho * MARS_R * T, a: Math.sqrt(MARS_GAMMA * MARS_R * T) };
}

export function atmosphereFor(planetDef, densityScale = 1) {
  const base = planetDef.atmosphere === 'us76' ? us76 : marsSimple;
  if (densityScale === 1) return base;
  return (alt) => {
    const s = base(alt);
    return { ...s, rho: s.rho * densityScale, P: s.P * densityScale };
  };
}
