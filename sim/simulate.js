// 3-degree-of-freedom atmospheric entry simulation.
//
// State: inertial position and velocity, and mass (7 values). Forces: J2 gravity, drag, lift (rotated by bank angle
// about the air-relative velocity), optional parachute drag, optional speculative magnetic drag, and an optional
// electric thruster (thrust = 2·efficiency·power / exhaust speed, along or against the inertial velocity) that burns
// propellant, so the mass falls while it runs.
// The atmosphere co-rotates with the planet, so aerodynamics use the air-relative velocity v - ω×r.
// Integration: Dormand–Prince 5(4) with adaptive step size and event location by bisection.

import { G0, planet } from './constants.js';
import { atmosphereFor } from './atmosphere.js';
import { gravityJ2 } from './gravity.js';
import { convectiveSuttonGraves, radiativeTauberSutton, radiativeEquilibriumTemp } from './heating.js';
import { add, sub, scale, dot, cross, norm, unit, rad, deg, inertialToFixed, fixedToInertial, geodeticToFixed, fixedToGeodetic, enu, angleBetween } from './frames.js';
import { DEFAULTS, deepMerge, clone } from './params.js';

export const MODEL_VERSION = '1.0.0';

const DP = {
  c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
  a: [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]
  ],
  b5: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
  b4: [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40]
};

export function normalizeParams(input) {
  return deepMerge(clone(DEFAULTS), clone(input || {}));
}

export function simulate(input) {
  const params = normalizeParams(input);
  const P = planet(params.planet);
  const atm = atmosphereFor(P, params.environment.densityScale);
  const veh = params.vehicle, chute = veh.chute, mhd = veh.mhd || { factor: 0, efficiency: 0 };
  const g = params.guidance, entry = params.entry;
  const W = [0, 0, P.omega];

  // Electric thruster. Propellant is part of veh.mass; thrust stops when it runs out or below cutoffAlt.
  const thr = veh.thruster || {};
  const thrOn = !!thr.enabled && thr.power > 0 && thr.efficiency > 0 && thr.exhaustSpeed > 0 && thr.propellant > 0;
  const thrust = thrOn ? (2 * thr.efficiency * thr.power) / thr.exhaustSpeed : 0;
  const mdot = thrOn ? thrust / thr.exhaustSpeed : 0;
  const m0 = veh.mass;
  const mDry = thrOn ? m0 - Math.min(thr.propellant, 0.95 * m0) : m0;
  const thrSign = thr.direction === 'prograde' ? 1 : -1;

  // ---------- initial state ----------
  const lat0 = rad(entry.lat), lon0 = rad(entry.lon);
  const r0 = geodeticToFixed(lat0, lon0, entry.alt, P.Req, P.f);
  const L0 = enu(lat0, lon0);
  const az = rad(entry.azimuth), gam = rad(entry.fpa);
  const hdir = add(scale(L0.north, Math.cos(az)), scale(L0.east, Math.sin(az)));
  const vdir = add(scale(hdir, Math.cos(gam)), scale(L0.up, Math.sin(gam)));
  const v0 = scale(vdir, entry.speed); // inertial at t = 0 (inertial and fixed frames coincide)
  let y = [...r0, ...v0, m0];
  let t = 0;

  const vRel0F = sub(v0, cross(W, r0));
  const r0hat = unit(r0);
  const planeN = unit(cross(r0, vRel0F));

  // Parachute state: 0 = stowed, 1 = drogue out, 2 = main out. Canopies inflate over chute.fillTime seconds.
  const CH = { stage: 0, t1: 0, t2: 0 };
  let chuteOut = CH;
  const fill = (dt) => { const x = Math.min(1, Math.max(0, dt / Math.max(chute.fillTime || 0.01, 0.01))); return x * x; };
  const chuteCdA = (time, cs) => {
    if (!cs || cs.stage === 0) return 0;
    if (cs.stage === 1) return (chute.drogueCd || 0) * (chute.drogueArea || 0) * fill(time - cs.t1);
    return chute.cd * chute.area * fill(time - cs.t2);
  };
  const bankAt = (time) => {
    if (g.mode === 'spin') return { bank: 0, ld: 0 };
    let b = g.bank;
    if (g.mode === 'reversal' && Math.floor(time / g.reversalPeriod) % 2 === 1) b = -b;
    return { bank: b, ld: veh.liftToDrag };
  };

  // ---------- dynamics and diagnostics ----------
  function evaluate(time, s, chuteState) {
    const r = [s[0], s[1], s[2]], v = [s[3], s[4], s[5]];
    const rF = inertialToFixed(r, P.omega, time);
    const geo = fixedToGeodetic(rF, P.Req, P.f);
    const alt = geo.h;
    const air = atm(alt);
    const vRel = sub(v, cross(W, r));
    const V = norm(vRel);
    const vhat = V > 0 ? scale(vRel, 1 / V) : [0, 0, 0];
    const qDyn = 0.5 * air.rho * V * V;
    const m = s[6];
    const CdA = veh.cd * veh.refArea + chuteCdA(time, chuteState);
    const aD = qDyn * CdA / m;
    const ramp = Math.min(1, Math.max(0, (V - 3000) / 2000));
    const aM = (mhd.factor || 0) * (qDyn * veh.cd * veh.refArea / m) * ramp;
    const gb = bankAt(time);
    const ld = chuteState && chuteState.stage > 0 ? 0 : gb.ld;
    const aL = ld * qDyn * veh.cd * veh.refArea / m;
    const thrusting = thrOn && m > mDry && alt > thr.cutoffAlt;
    const aT = thrusting ? thrust / m : 0;
    const upF = enu(geo.lat, geo.lon).up;
    const up = fixedToInertial(upF, P.omega, time);
    let l0 = sub(up, scale(vhat, dot(up, vhat)));
    l0 = unit(l0);
    const side = cross(vhat, l0);
    const sb = rad(gb.bank);
    const ldir = add(scale(l0, Math.cos(sb)), scale(side, Math.sin(sb)));
    const grav = gravityJ2(r, P.mu, P.Req, P.J2);
    let acc = add(grav, add(scale(vhat, -(aD + aM)), scale(ldir, aL)));
    if (aT) acc = add(acc, scale(unit(v), thrSign * aT));
    return { r, v, rF, geo, alt, air, vRel, V, qDyn, m, aD, aM, aL, aT, thrusting, acc, bank: chuteState && chuteState.stage > 0 ? 0 : gb.bank };
  }
  const deriv = (time, s, cs) => {
    const e = evaluate(time, s, cs);
    return [s[3], s[4], s[5], e.acc[0], e.acc[1], e.acc[2], e.thrusting ? -mdot : 0];
  };

  function rkStep(time, s, h, cs) {
    const k = [deriv(time, s, cs)];
    for (let i = 1; i < 7; i++) {
      const yi = s.slice();
      for (let j = 0; j < i; j++) {
        const aij = DP.a[i][j];
        if (aij) for (let n = 0; n < 7; n++) yi[n] += h * aij * k[j][n];
      }
      k.push(deriv(time + DP.c[i] * h, yi, cs));
    }
    const y5 = s.slice(), y4 = s.slice();
    for (let n = 0; n < 7; n++) {
      for (let i = 0; i < 7; i++) {
        y5[n] += h * DP.b5[i] * k[i][n];
        y4[n] += h * DP.b4[i] * k[i][n];
      }
    }
    return { y5, y4 };
  }

  const rtol = params.sim.rtol;
  const atol = [1e-3, 1e-3, 1e-3, 1e-6, 1e-6, 1e-6, 1e-6];
  function errNorm(s, y5, y4) {
    let m = 0;
    for (let n = 0; n < 7; n++) {
      const sc = atol[n] + rtol * Math.max(Math.abs(s[n]), Math.abs(y5[n]));
      m = Math.max(m, Math.abs(y5[n] - y4[n]) / sc);
    }
    return m;
  }

  // ---------- output buffers ----------
  const cols = ['t', 'lat', 'lon', 'alt', 'x', 'y', 'z', 'vRel', 'vInertial', 'fpa', 'heading', 'mach', 'rho', 'temp',
    'qConv', 'qRad', 'q', 'heatLoad', 'g', 'qDyn', 'tWall', 'downrange', 'crossrange', 'bank', 'chute', 'power', 'harvest',
    'mass', 'thrust', 'propellant'];
  const out = Object.fromEntries(cols.map((c) => [c, []]));
  const events = [];
  const S = {
    peakQ: 0, peakQConv: 0, peakQRad: 0, tPeakQ: 0, altPeakQ: 0, vPeakQ: 0,
    peakG: 0, tPeakG: 0, peakChuteG: 0, peakDynP: 0, tPeakDynP: 0, peakTWall: 0, peakPower: 0, peakHarvest: 0,
    heatLoad: 0, harvested: 0, minAlt: entry.alt, tMach1: null
  };
  let prevQ = null, prevHarvest = 0, prevT = 0, prevMach = null, skipped = false, minAltReached = false, lastRec = 0;

  function record(time, s) {
    const e = evaluate(time, s, chuteOut);
    const air = e.air;
    const qC = convectiveSuttonGraves(P.suttonGravesK, air.rho, veh.noseRadius, e.V);
    const qR = P.radiative === 'tauber-sutton-earth' ? radiativeTauberSutton(air.rho, veh.noseRadius, e.V) : 0;
    const q = qC + qR;
    // Sensed acceleration: aerodynamic forces plus thrust (thrust taken as along the flight direction).
    const gload = Math.hypot(e.aD + e.aM - thrSign * e.aT, e.aL) / G0;
    const mach = e.V / air.a;
    const L = enu(e.geo.lat, e.geo.lon);
    const vRelF = inertialToFixed(e.vRel, P.omega, time);
    const fpa = Math.asin(Math.max(-1, Math.min(1, dot(vRelF, L.up) / Math.max(e.V, 1e-9))));
    const heading = (deg(Math.atan2(dot(vRelF, L.east), dot(vRelF, L.north))) + 360) % 360;
    const rhat = unit(e.rF);
    const downrange = angleBetween(r0hat, rhat) * P.meanRadius;
    const crossrange = Math.asin(Math.max(-1, Math.min(1, dot(rhat, planeN)))) * P.meanRadius;
    const power = (e.aD + e.aM) * e.m * e.V;
    const harvest = (mhd.efficiency || 0) * e.aM * e.m * e.V;
    const tWall = radiativeEquilibriumTemp(q, veh.emissivity);

    if (prevQ !== null) {
      const dt = time - prevT;
      S.heatLoad += 0.5 * (prevQ + q) * dt;
      S.harvested += 0.5 * (prevHarvest + harvest) * dt;
    }
    prevQ = q; prevHarvest = harvest; prevT = time;

    if (q > S.peakQ) { S.peakQ = q; S.tPeakQ = time; S.altPeakQ = e.alt; S.vPeakQ = e.V; }
    if (qC > S.peakQConv) S.peakQConv = qC;
    if (qR > S.peakQRad) S.peakQRad = qR;
    if (chuteOut.stage === 0) { if (gload > S.peakG) { S.peakG = gload; S.tPeakG = time; } }
    else if (gload > S.peakChuteG) S.peakChuteG = gload;
    if (e.qDyn > S.peakDynP) { S.peakDynP = e.qDyn; S.tPeakDynP = time; }
    if (tWall > S.peakTWall) S.peakTWall = tWall;
    if (power > S.peakPower) S.peakPower = power;
    if (harvest > S.peakHarvest) S.peakHarvest = harvest;
    if (e.alt < S.minAlt) S.minAlt = e.alt;
    if (prevMach !== null && prevMach >= 1 && mach < 1 && S.tMach1 === null && e.alt < 90000) {
      S.tMach1 = time;
      events.push({ type: 'mach1', t: time, label: 'Subsonic' });
    }
    prevMach = mach;

    const row = {
      t: time, lat: deg(e.geo.lat), lon: deg(e.geo.lon), alt: e.alt, x: e.rF[0], y: e.rF[1], z: e.rF[2],
      vRel: e.V, vInertial: norm(e.v), fpa: deg(fpa), heading, mach, rho: air.rho, temp: air.T,
      qConv: qC, qRad: qR, q, heatLoad: S.heatLoad, g: gload, qDyn: e.qDyn, tWall,
      downrange, crossrange, bank: e.bank, chute: chuteOut.stage, power, harvest,
      mass: e.m, thrust: e.thrusting ? thrust : 0, propellant: Math.max(0, e.m - mDry)
    };
    for (const c of cols) out[c].push(row[c]);
    lastRec = time;
    return row;
  }

  const altOf = (time, s) => fixedToGeodetic(inertialToFixed([s[0], s[1], s[2]], P.omega, time), P.Req, P.f).h;

  // Find the step size within (0, h] where altitude crosses `target` going down.
  function locate(time, s, h, target) {
    let lo = 0, hi = h, best = null;
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      const { y5 } = rkStep(time, s, mid, chuteOut);
      const a = altOf(time + mid, y5);
      if (a > target) lo = mid; else { hi = mid; best = y5; }
      if (hi - lo < 1e-4) break;
    }
    if (!best) best = rkStep(time, s, hi, chuteOut).y5;
    return { h: hi, y: best };
  }

  // ---------- integrate ----------
  events.push({ type: 'entry', t: 0, label: 'Entry interface' });
  const thrustingAt = (time, s) => thrOn && s[6] > mDry && altOf(time, s) > thr.cutoffAlt;
  let wasThrusting = thrustingAt(0, y);
  if (wasThrusting) events.push({ type: 'thrustOn', t: 0, label: 'Thruster on' });
  record(t, y);
  let h = 0.5;
  let outcome = 'timeout';
  let landing = null;
  let steps = 0, rejected = 0;
  const maxTime = params.sim.maxTime;

  while (t < maxTime) {
    const alt = altOf(t, y);
    const hmax = alt > 140000 ? 20 : CH.stage > 0 ? 0.5 : alt > 20000 ? 1 : 2;
    h = Math.min(h, hmax, maxTime - t);
    const { y5, y4 } = rkStep(t, y, h, chuteOut);
    const err = errNorm(y, y5, y4);
    if (err > 1 && h > 1e-6) {
      rejected++;
      h *= Math.max(0.2, 0.9 * Math.pow(err, -0.2));
      continue;
    }
    let yn = y5, hn = h;
    const altN = altOf(t + h, yn);

    // Events, in order of priority
    if (altN <= 0) {
      const f = locate(t, y, h, 0);
      t += f.h; y = f.y;
      const row = record(t, y);
      landing = row;
      outcome = 'landed';
      events.push({ type: 'touchdown', t, label: 'Touchdown' });
      break;
    }
    if (chute.enabled && CH.stage === 0 && alt > chute.deployAlt && altN <= chute.deployAlt) {
      const f = locate(t, y, h, chute.deployAlt);
      t += f.h; y = f.y;
      const row = record(t, y);
      const hasDrogue = (chute.drogueArea || 0) > 0;
      CH.stage = hasDrogue ? 1 : 2; CH.t1 = t; CH.t2 = t;
      events.push({ type: 'chute', t, label: hasDrogue ? 'Drogue chute' : 'Parachute', mach: row.mach, speed: row.vRel });
      S.chuteMach = row.mach; S.chuteSpeed = row.vRel; S.chuteQDyn = row.qDyn;
      h = 0.02; steps++;
      continue;
    }
    if (chute.enabled && CH.stage === 1 && alt > chute.mainAlt && altN <= chute.mainAlt) {
      const f = locate(t, y, h, chute.mainAlt);
      t += f.h; y = f.y;
      const row = record(t, y);
      CH.stage = 2; CH.t2 = t;
      events.push({ type: 'main', t, label: 'Main chute', mach: row.mach, speed: row.vRel });
      S.mainSpeed = row.vRel;
      h = 0.02; steps++;
      continue;
    }

    t += hn; y = yn; steps++;
    const thrustingNow = thrustingAt(t, y);
    if (thrustingNow !== wasThrusting) {
      const why = y[6] <= mDry ? 'propellant used up' : `below ${Math.round(thr.cutoffAlt / 1000)} km`;
      events.push(thrustingNow ? { type: 'thrustOn', t, label: 'Thruster on' } : { type: 'thrustOff', t, label: `Thruster off: ${why}` });
    }
    // Above the air nothing changes quickly, so long orbital runs record at most once a minute.
    if (altN > 140000 && t - lastRec < 60 && thrustingNow === wasThrusting) {
      const rr = [y[0], y[1], y[2]], vv = [y[3], y[4], y[5]];
      if (altN > 1500000 || (dot(vv, vv) / 2 - P.mu / norm(rr) > 0 && dot(rr, vv) > 0)) { record(t, y); outcome = 'escaped'; break; }
      h = hn * Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-12), -0.2)));
      if (steps > 400000) break;
      continue;
    }
    wasThrusting = thrustingNow;
    const row = record(t, y);
    // A skip needs a real dip into the air first (an orbit's small altitude wobble doesn't count).
    if (!minAltReached && row.fpa > 0 && row.alt < Math.min(entry.alt, 120000)) minAltReached = true;
    if (minAltReached && !skipped && row.alt > entry.alt) {
      skipped = true;
      events.push({ type: 'skip', t, label: 'Skipped out of the atmosphere' });
    }
    if (skipped && row.alt < entry.alt && row.fpa < 0 && !events.some((e) => e.type === 'reentry')) {
      events.push({ type: 'reentry', t, label: 'Second entry' });
    }
    const energy = dot([y[3], y[4], y[5]], [y[3], y[4], y[5]]) / 2 - P.mu / norm([y[0], y[1], y[2]]);
    if (row.alt > 1500000 || (energy > 0 && row.fpa > 0)) { outcome = 'escaped'; break; }

    h = hn * Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-12), -0.2)));
    if (steps > 400000) break;
  }
  if (out.t[out.t.length - 1] < t) record(t, y); // the thinned-out orbital stretch may have skipped the last moment
  if (outcome === 'timeout' && skipped && out.alt[out.alt.length - 1] > entry.alt) outcome = 'skipped';

  // ---------- summary ----------
  for (const [type, tt, label] of [['peakQ', S.tPeakQ, 'Peak heating'], ['peakG', S.tPeakG, 'Peak g-force'], ['peakDynP', S.tPeakDynP, 'Peak dynamic pressure']]) {
    events.push({ type, t: tt, label });
  }
  events.sort((a, b) => a.t - b.t);

  const rad0 = norm(r0);
  const vRel0 = norm(vRel0F);
  const kin0 = 0.5 * veh.mass * vRel0 * vRel0;
  const pot0 = veh.mass * (P.mu / P.meanRadius - P.mu / rad0);
  const n = out.t.length;
  const last = (c) => out[c][n - 1];
  const summary = {
    outcome,
    skipped,
    flightTime: last('t'),
    ballisticCoefficient: veh.mass / (veh.cd * veh.refArea),
    peakHeatFlux: S.peakQ, peakHeatFluxConvective: S.peakQConv, peakHeatFluxRadiative: S.peakQRad,
    timeOfPeakHeatFlux: S.tPeakQ, altitudeAtPeakHeatFlux: S.altPeakQ, speedAtPeakHeatFlux: S.vPeakQ,
    heatLoad: S.heatLoad, // J/cm^2 at the stagnation point
    peakG: S.peakG, timeOfPeakG: S.tPeakG, peakParachuteG: S.peakChuteG,
    peakDynamicPressure: S.peakDynP,
    peakWallTemp: S.peakTWall,
    peakBrakingPower: S.peakPower,
    harvestedEnergy: S.harvested, peakHarvestPower: S.peakHarvest,
    thruster: thrOn ? {
      thrust, propellantFlow: mdot,
      propellantUsed: m0 - last('mass'),
      burnTime: (m0 - last('mass')) / mdot,
      deltaV: thr.exhaustSpeed * Math.log(m0 / last('mass'))
    } : null,
    timeSubsonic: S.tMach1,
    chuteDeployMach: S.chuteMach ?? null, chuteDeploySpeed: S.chuteSpeed ?? null, chuteDeployDynamicPressure: S.chuteQDyn ?? null,
    mainDeploySpeed: S.mainSpeed ?? null,
    landingSpeed: landing ? landing.vRel : null,
    landingLat: landing ? landing.lat : null, landingLon: landing ? landing.lon : null,
    finalAltitude: last('alt'),
    downrange: last('downrange'), crossrange: last('crossrange'),
    entryRelativeSpeed: vRel0,
    entryKineticEnergy: kin0, entryPotentialEnergy: pot0,
    minAltitude: S.minAlt,
    steps, rejected
  };
  const lim = params.limits;
  summary.checks = {
    heatFlux: { ok: S.peakQ <= lim.heatFlux, value: S.peakQ, limit: lim.heatFlux },
    heatLoad: { ok: S.heatLoad <= lim.heatLoad, value: S.heatLoad, limit: lim.heatLoad },
    gLoad: { ok: Math.max(S.peakG, S.peakChuteG) <= lim.gLoad, value: Math.max(S.peakG, S.peakChuteG), limit: lim.gLoad },
    chute: chute.enabled ? { ok: summary.chuteDeployMach != null && summary.chuteDeployMach <= chute.maxMach, value: summary.chuteDeployMach, limit: chute.maxMach } : null,
    landing: { ok: outcome === 'landed' && summary.landingSpeed <= lim.landingSpeed, value: summary.landingSpeed, limit: lim.landingSpeed }
  };

  return { model: MODEL_VERSION, params, columns: cols, samples: out, events, summary };
}

// Compact summary suitable for logs, the CLI and the research agent.
export function brief(result) {
  const s = result.summary;
  const r = (v, d = 1) => (v == null ? null : Number(v.toFixed(d)));
  return {
    outcome: s.outcome,
    flightTime_s: r(s.flightTime, 0),
    ballisticCoefficient_kg_m2: r(s.ballisticCoefficient, 1),
    peakHeatFlux_W_cm2: r(s.peakHeatFlux), convective_W_cm2: r(s.peakHeatFluxConvective), radiative_W_cm2: r(s.peakHeatFluxRadiative),
    altitudeAtPeakHeating_km: r(s.altitudeAtPeakHeatFlux / 1000, 1),
    heatLoad_kJ_cm2: r(s.heatLoad / 1000, 2),
    peakG: r(s.peakG, 2), peakParachuteG: r(s.peakParachuteG, 2),
    peakDynamicPressure_kPa: r(s.peakDynamicPressure / 1000, 2),
    peakWallTemp_K: r(s.peakWallTemp, 0),
    peakBrakingPower_MW: r(s.peakBrakingPower / 1e6, 0),
    timeSubsonic_s: r(s.timeSubsonic, 0),
    chuteDeployMach: r(s.chuteDeployMach, 2),
    landingSpeed_m_s: r(s.landingSpeed, 2),
    landing: s.landingLat == null ? null : { lat: r(s.landingLat, 3), lon: r(s.landingLon, 3) },
    downrange_km: r(s.downrange / 1000, 0), crossrange_km: r(s.crossrange / 1000, 1),
    harvestedEnergy_GJ: r(s.harvestedEnergy / 1e9, 2),
    thruster: s.thruster ? { thrust_N: r(s.thruster.thrust, 3), propellantUsed_kg: r(s.thruster.propellantUsed, 2), burnTime_h: r(s.thruster.burnTime / 3600, 1), deltaV_m_s: r(s.thruster.deltaV, 1) } : null,
    checks: Object.fromEntries(Object.entries(s.checks).filter(([, v]) => v).map(([k, v]) => [k, v.ok ? 'ok' : 'exceeded']))
  };
}
