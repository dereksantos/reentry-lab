// Campaign balance: every contract fails as briefed and can be won by tuning its knobs (found by sweeping them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../sim/index.js';
import { MISSIONS, missionById, missionParams, scoreRun, distanceKm } from '../src/game/missions.js';
import { UPGRADES, applyUpgrades } from '../src/game/upgrades.js';

const ALL = UPGRADES.map((u) => u.id);
// [mission, upgrades owned, winning knob values]
const WINS = [
  ['first-light', [], { 'entry.fpa': -0.8 }],
  ['gentle-hands', [], { 'entry.fpa': -2.5, 'guidance.bank': 30 }],
  ['bullseye', [], { 'entry.fpa': -1.0, 'guidance.bank': 70 }],
  ['moonshot', ['shield2'], { 'entry.fpa': -6, 'guidance.bank': 60 }],
  ['skip-artist', ['shield2'], { 'entry.fpa': -6, 'guidance.bank': 60 }],
  ['space-janitor', ['ion'], { 'vehicle.thruster.direction': 'retrograde', 'vehicle.thruster.cutoffAlt': 60000, 'vehicle.thruster.propellant': 10 }],
  ['red-dust', [], { 'entry.fpa': -12, 'guidance.bank': 90, 'vehicle.chute.deployAlt': 4000 }],
  ['featherfall', ['antigrav'], { 'vehicle.antigrav.factor': 0.98, 'vehicle.antigrav.startAlt': 10000, 'entry.fpa': -0.4 }]
];

test('Every contract has a known winning setup', () => {
  assert.deepEqual(WINS.map((w) => w[0]).sort(), MISSIONS.map((m) => m.id).sort());
  for (const [id, owned, knobs] of WINS) {
    const m = missionById(id);
    const sc = scoreRun(m, simulate(missionParams(m, owned, knobs)).summary);
    assert.ok(sc.complete, `${id} should be winnable: ${JSON.stringify(sc.goal)}`);
  }
});

test('No contract passes as briefed, even with every upgrade', () => {
  for (const m of MISSIONS) {
    for (const owned of [m.requires ? [m.requires] : [], ALL]) {
      const sc = scoreRun(m, simulate(missionParams(m, owned)).summary);
      assert.equal(sc.complete, false, `${m.id} passes untouched with [${owned}]`);
    }
  }
});

test('Upgrades only change what they say', () => {
  const p = applyUpgrades(missionParams(missionById('bullseye'), []), ['shield2', 'chute2']);
  assert.equal(p.limits.heatFlux, 400);
  assert.equal(p.vehicle.antigrav.factor, 0);
  const mars = missionParams(missionById('red-dust'), ['trim']);
  assert.equal(mars.vehicle.liftToDrag, 0.24, 'trim must not apply to the Mars lander');
  assert.ok(Math.abs(distanceKm(0, 0, 0, 1) - 111.19) < 0.1);
});
