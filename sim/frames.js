// Vector helpers and reference-frame conversions.
// Inertial frame (ECI-like): z along the spin axis, x aligned with the planet-fixed x axis at t = 0.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => { const n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; };

const DEG = Math.PI / 180;
export const rad = (d) => d * DEG;
export const deg = (r) => r / DEG;

// Rotate an inertial vector into the planet-fixed frame at time t.
export function inertialToFixed(v, omega, t) {
  const th = omega * t, c = Math.cos(th), s = Math.sin(th);
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]];
}
export function fixedToInertial(v, omega, t) {
  const th = omega * t, c = Math.cos(th), s = Math.sin(th);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

// Geodetic latitude/longitude (rad) and height (m) above the reference ellipsoid -> planet-fixed position.
export function geodeticToFixed(lat, lon, h, Req, f) {
  const e2 = f * (2 - f);
  const sl = Math.sin(lat), cl = Math.cos(lat);
  const N = Req / Math.sqrt(1 - e2 * sl * sl);
  return [(N + h) * cl * Math.cos(lon), (N + h) * cl * Math.sin(lon), (N * (1 - e2) + h) * sl];
}

// Planet-fixed position -> geodetic latitude/longitude (rad) and height (m). Iterative, converges to < 1 mm.
export function fixedToGeodetic(r, Req, f) {
  const [x, y, z] = r;
  const e2 = f * (2 - f);
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const sl = Math.sin(lat);
    const N = Req / Math.sqrt(1 - e2 * sl * sl);
    const cl = Math.cos(lat);
    h = Math.abs(cl) > 1e-6 ? p / cl - N : Math.abs(z) / Math.abs(sl) - N * (1 - e2);
    lat = Math.atan2(z, p * (1 - e2 * N / (N + h)));
  }
  return { lat, lon, h };
}

// Local east/north/up unit vectors (planet-fixed) at geodetic lat/lon.
export function enu(lat, lon) {
  const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  return {
    east: [-so, co, 0],
    north: [-sl * co, -sl * so, cl],
    up: [cl * co, cl * so, sl]
  };
}

// Great-circle angle between two unit vectors (rad).
export function angleBetween(a, b) {
  return Math.atan2(norm(cross(a, b)), dot(a, b));
}
