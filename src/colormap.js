// Sequential heat colormap: cool slate (barely heated) through red and orange to pale yellow (peak).
// Lightness rises monotonically so it reads without relying on hue.
const STOPS = [
  [0.0, [58, 76, 120]],
  [0.25, [122, 64, 160]],
  [0.5, [214, 64, 78]],
  [0.75, [255, 138, 61]],
  [1.0, [255, 240, 170]]
];
export function heatRGB(x) {
  const v = Math.min(1, Math.max(0, x));
  let i = 0;
  while (i < STOPS.length - 2 && v > STOPS[i + 1][0]) i++;
  const [a, ca] = STOPS[i], [b, cb] = STOPS[i + 1];
  const f = (v - a) / (b - a);
  return [0, 1, 2].map((k) => (ca[k] + f * (cb[k] - ca[k])) / 255);
}
export function heatCss(x) {
  const [r, g, b] = heatRGB(x);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}
export function heatGradient() {
  return `linear-gradient(90deg, ${STOPS.map(([p, c]) => `rgb(${c.join(',')}) ${p * 100}%`).join(', ')})`;
}
// Log scale from 1 W/cm² to qMax.
export function heatScale(qMax) {
  const top = Math.log10(Math.max(qMax, 10));
  return (q) => Math.log10(Math.max(q, 1)) / top;
}

// Approximate color of a blackbody at temperature T (K). Tanner Helland's fit, good for 1000–40000 K.
export function blackbody(T) {
  const t = Math.max(1000, Math.min(40000, T)) / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.min(255, Math.max(0, v)) / 255;
  return [c(r), c(g), c(b)];
}
