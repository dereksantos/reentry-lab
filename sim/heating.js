// Stagnation-point heating correlations. All return W/cm^2.
import { SIGMA } from './constants.js';

// Sutton & Graves (1971): q = k * sqrt(rho / Rn) * V^3   (convective, cold wall)
export function convectiveSuttonGraves(k, rho, Rn, V) {
  return (k * Math.sqrt(rho / Rn) * V * V * V) / 1e4;
}

// Tauber & Sutton (1991) radiative heating correlation for Earth entry:
//   q = C * Rn^a * rho^b * f(V),  C = 4.736e4, b = 1.22,  a = min(1, 1.072e6 * V^-1.88 * rho^-0.325)
// f(V) is tabulated for 9–16 km/s. Below 9 km/s radiative heating is taken as zero.
// The correlation was fit for roughly 6.6e-5 < rho < 6.3e-4 kg/m^3; outside that the value is an extrapolation.
const TS_V = [9.0, 9.25, 9.5, 9.75, 10.0, 10.25, 10.5, 10.75, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5, 16.0];
const TS_F = [1.5, 4.3, 9.7, 19.5, 35, 55, 81, 115, 151, 238, 359, 495, 660, 850, 1065, 1313, 1550, 1780, 2040];
function tsF(Vkms) {
  if (Vkms < TS_V[0]) return 0;
  if (Vkms >= TS_V[TS_V.length - 1]) return TS_F[TS_F.length - 1];
  let i = 0;
  while (TS_V[i + 1] < Vkms) i++;
  const s = (Vkms - TS_V[i]) / (TS_V[i + 1] - TS_V[i]);
  return TS_F[i] + s * (TS_F[i + 1] - TS_F[i]);
}
export function radiativeTauberSutton(rho, Rn, V) {
  if (V < 9000 || rho <= 0) return 0;
  const a = Math.min(1.0, 1.072e6 * Math.pow(V, -1.88) * Math.pow(rho, -0.325));
  return 4.736e4 * Math.pow(Rn, a) * Math.pow(rho, 1.22) * tsF(V / 1000);
}

// Radiative-equilibrium wall temperature for a given total heat flux (W/cm^2) and surface emissivity.
export function radiativeEquilibriumTemp(qWcm2, emissivity) {
  if (qWcm2 <= 0) return 0;
  return Math.pow((qWcm2 * 1e4) / (emissivity * SIGMA), 0.25);
}
