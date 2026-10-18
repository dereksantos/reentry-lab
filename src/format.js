export function sig(v, digits = 3) {
  if (v == null || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 10000) return Math.round(v).toLocaleString('en-US');
  if (a >= 100) return v.toFixed(0);
  if (a === 0) return '0';
  return (+v.toPrecision(digits)).toString();
}
export function clock(t) {
  if (t == null || !Number.isFinite(t)) return '–';
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
export function energy(j) {
  if (j >= 1e12) return sig(j / 1e12) + ' TJ';
  if (j >= 1e9) return sig(j / 1e9) + ' GJ';
  return sig(j / 1e6) + ' MJ';
}
export function power(w) {
  if (w >= 1e9) return sig(w / 1e9) + ' GW';
  if (w >= 1e6) return sig(w / 1e6) + ' MW';
  return sig(w / 1e3) + ' kW';
}
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Value of every sampled column at time t (linear interpolation).
export function sampleAt(result, t) {
  const s = result.samples, T = s.t, n = T.length;
  if (!n) return null;
  if (t <= T[0]) return rowAt(result, 0);
  if (t >= T[n - 1]) return rowAt(result, n - 1);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
  const f = (t - T[lo]) / (T[hi] - T[lo] || 1);
  const out = {};
  for (const c of result.columns) out[c] = s[c][lo] + f * (s[c][hi] - s[c][lo]);
  out.chute = s.chute[lo];
  out.index = lo;
  return out;
}
function rowAt(result, i) {
  const out = {};
  for (const c of result.columns) out[c] = result.samples[c][i];
  out.index = i;
  return out;
}
