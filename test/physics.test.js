import { test } from 'node:test';
import assert from 'node:assert/strict';
import { us76, simulate, preset, deepMerge, PLANETS, parseAssignment } from '../sim/index.js';
import { geodeticToFixed, fixedToGeodetic, rad } from '../sim/frames.js';

const close = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);

test('US76: sea level and tropopause match the standard', () => {
  const s0 = us76(0);
  assert.ok(close(s0.rho, 1.225, 1e-3), `rho0 ${s0.rho}`);
  assert.ok(close(s0.T, 288.15, 1e-6));
  assert.ok(close(s0.a, 340.29, 1e-3), `a0 ${s0.a}`);
  const s11 = us76(11019);           // 11 km geopotential
  assert.ok(close(s11.T, 216.65, 1e-3), `T11 ${s11.T}`);
  const s20 = us76(20000);
  assert.ok(close(s20.rho, 8.891e-2, 5e-3), `rho20 ${s20.rho}`);
});

test('US76: the computed and tabulated parts join smoothly at 86 km', () => {
  const below = us76(85999).rho, above = us76(86001).rho;
  assert.ok(close(below, above, 0.03), `${below} vs ${above}`);
});

test('Geodetic conversions round-trip to under a millimetre', () => {
  const E = PLANETS.earth;
  for (const [la, lo, h] of [[0, 0, 0], [45, 120, 120000], [-89, -170, 5000], [30, 20, -100]]) {
    const r = geodeticToFixed(rad(la), rad(lo), h, E.Req, E.f);
    const g = fixedToGeodetic(r, E.Req, E.f);
    assert.ok(Math.abs(g.h - h) < 1e-3, `h ${g.h} vs ${h}`);
    assert.ok(Math.abs(g.lat - rad(la)) < 1e-9);
  }
});

test('Vacuum orbit conserves energy, including the J2 potential', () => {
  const E = PLANETS.earth;
  const r = simulate({
    environment: { densityScale: 1e-30 }, vehicle: { chute: { enabled: false } },
    entry: { alt: 400000, speed: 7670, fpa: 0, azimuth: 45, lat: 10, lon: 0 },
    sim: { maxTime: 5600, rtol: 1e-10 }
  });
  const s = r.samples;
  const energy = (i) => {
    const x = s.x[i], y = s.y[i], z = s.z[i];
    const rr = Math.hypot(x, y, z), sinp = z / rr;
    const U = -E.mu / rr * (1 - E.J2 * (E.Req / rr) ** 2 * (3 * sinp * sinp - 1) / 2);
    return 0.5 * s.vInertial[i] ** 2 + U;
  };
  const e0 = energy(0), e1 = energy(s.t.length - 1);
  assert.ok(Math.abs((e1 - e0) / e0) < 1e-8, `relative drift ${(e1 - e0) / e0}`);
});

test('Ballistic peak deceleration matches the Allen–Eggers estimate', () => {
  // Peak decel for an exponential atmosphere: V^2 sin|γ| / (2 e H). US76 is not exponential, so allow 20%.
  const V = 7000, gam = 20, H = 7100;
  const expected = V * V * Math.sin(rad(gam)) / (2 * Math.E * H) / 9.80665;
  const r = simulate({ vehicle: { mass: 500, refArea: 0.5, cd: 1, liftToDrag: 0, chute: { enabled: false } }, guidance: { mode: 'spin' },
    entry: { alt: 120000, speed: V, fpa: -gam, azimuth: 90, lat: 0, lon: 0 } });
  assert.ok(close(r.summary.peakG, expected, 0.2), `sim ${r.summary.peakG} vs ${expected}`);
});

test('Peak g of a ballistic entry changes little with ballistic coefficient; peak heating changes a lot', () => {
  const run = (mass) => simulate({ vehicle: { mass, refArea: 1, cd: 1, liftToDrag: 0, chute: { enabled: false } }, guidance: { mode: 'spin' },
    entry: { alt: 120000, speed: 7500, fpa: -5, azimuth: 90, lat: 0, lon: 0 } }).summary;
  const light = run(50), heavy = run(1000);
  // 20x change in beta. In an exponential atmosphere peak g would be identical; US76's varying scale height allows ~25%.
  assert.ok(close(light.peakG, heavy.peakG, 0.25), `${light.peakG} vs ${heavy.peakG}`);
  assert.ok(heavy.peakHeatFlux > 2.5 * light.peakHeatFlux);
});

test('A very shallow lift-up entry skips out of the atmosphere', () => {
  const r = simulate(deepMerge(preset('leo-capsule').params, { guidance: { mode: 'constant', bank: 0 }, entry: { fpa: -0.4, speed: 7900 }, sim: { maxTime: 900 } }));
  assert.equal(r.summary.skipped, true);
});

test('Presets run and land', () => {
  for (const key of ['leo-capsule', 'lunar-return', 'sample-return', 'mars-lander', 'electric-deorbit']) {
    const r = simulate(preset(key).params);
    assert.equal(r.summary.outcome, 'landed', key);
    assert.ok(r.summary.peakHeatFlux > 0);
  }
});

test('Lunar-return speeds produce radiative heating; low orbit does not', () => {
  assert.ok(simulate(preset('lunar-return').params).summary.peakHeatFluxRadiative > 10);
  assert.equal(simulate(preset('leo-capsule').params).summary.peakHeatFluxRadiative, 0);
});

test('Assignments accept display units', () => {
  assert.equal(parseAssignment('entry.alt=120').value, 120000);
  assert.equal(parseAssignment('entry.speed=7.8').value, 7800);
  assert.equal(parseAssignment('guidance.mode=spin').value, 'spin');
  assert.throws(() => parseAssignment('nope=1'));
});

// Two hours in a vacuum orbit (no air) from 500 km, with or without electric thrust.
const thrustRun = (direction) => simulate({
  environment: { densityScale: 1e-30 },
  vehicle: { mass: 1000, chute: { enabled: false }, thruster: { enabled: !!direction, power: 10000, efficiency: 0.6, exhaustSpeed: 20000, propellant: 50, direction, cutoffAlt: 0 } },
  entry: { alt: 500000, speed: 7613, fpa: 0, azimuth: 45, lat: 0, lon: 0 },
  sim: { maxTime: 7200, rtol: 1e-10 }
});
// Point-mass semi-major axis from the final state. Earth's bulge (J2) makes this wobble by kilometres on its own,
// so compare runs against an unthrusted one over the same time.
const semiMajor = (r) => {
  const s = r.samples, i = s.t.length - 1, rr = Math.hypot(s.x[i], s.y[i], s.z[i]);
  return 1 / (2 / rr - s.vInertial[i] ** 2 / PLANETS.earth.mu);
};

test('Electric thrust and propellant flow follow thrust = 2·efficiency·power / exhaust speed', () => {
  const r = thrustRun('prograde');
  const thrust = (2 * 0.6 * 10000) / 20000; // 0.6 N
  const used = (thrust / 20000) * 7200; // kg
  const th = r.summary.thruster;
  assert.ok(close(th.thrust, thrust, 1e-12));
  assert.ok(close(th.propellantUsed, used, 1e-3), `used ${th.propellantUsed} vs ${used}`);
  assert.ok(close(th.deltaV, 20000 * Math.log(1000 / (1000 - used)), 1e-6));
  assert.ok(close(r.samples.mass.at(-1), 1000 - used, 1e-6));
});

test('Retrograde thrust lowers an orbit and prograde raises it, by about the speed change given', () => {
  const coast = thrustRun(null), up = thrustRun('prograde'), down = thrustRun('retrograde');
  const a = semiMajor(coast), raised = semiMajor(up) - a, lowered = a - semiMajor(down);
  // For gentle thrust, the change in semi-major axis is about 2·Δv / mean motion: a few kilometres here.
  const expected = (2 * up.summary.thruster.deltaV) / Math.sqrt(PLANETS.earth.mu / a ** 3);
  assert.ok(close(raised, expected, 0.02), `raised ${raised} m, expected about ${expected} m`);
  assert.ok(close(lowered, expected, 0.02), `lowered ${lowered} m, expected about ${expected} m`);
});

test('The thruster is off by default and the mass stays constant', () => {
  const r = simulate(preset('leo-capsule').params);
  assert.equal(r.summary.thruster, null);
  assert.ok(r.samples.mass.every((m) => m === preset('leo-capsule').params.vehicle.mass));
});
