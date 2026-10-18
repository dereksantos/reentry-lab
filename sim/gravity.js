// Gravity: point mass plus the J2 oblateness term. Works in either frame because J2 is axisymmetric about z.
export function gravityJ2(r, mu, Req, J2) {
  const [x, y, z] = r;
  const r2 = x * x + y * y + z * z;
  const rn = Math.sqrt(r2);
  const k = mu / (r2 * rn);
  const q = 1.5 * J2 * (Req * Req) / r2;
  const zz = 5 * z * z / r2;
  return [
    -k * x * (1 - q * (zz - 1)),
    -k * y * (1 - q * (zz - 1)),
    -k * z * (1 - q * (zz - 3))
  ];
}
