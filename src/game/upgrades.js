// Campaign upgrades: bought with credits, applied to the vehicle of every mission you fly.
// Numbers are tuned for play (a game ion drive is far stronger than a real one); the physics stays the simulator's.

export const UPGRADES = [
  { id: 'chute2', name: 'Ringsail main chute', cost: 120, icon: 'chute', desc: '60% more canopy area. Softer landings everywhere.' },
  { id: 'shield2', name: 'Heat shield Mk II', cost: 160, icon: 'shield', desc: 'Phenolic tiles: takes 1.6× the heat. Needed for Moon-speed returns.' },
  { id: 'trim', name: 'Lifting trim', cost: 200, icon: 'wing', desc: 'Offsets the center of mass for +0.15 lift-to-drag on Earth capsules: more steering, gentler entries.' },
  { id: 'computer', name: 'Flight computer', cost: 220, icon: 'chip', desc: 'Shows the predicted path and landing point before you launch.' },
  { id: 'ion', name: 'Ion drive', cost: 260, icon: 'ion', desc: 'A 300 kW electric thruster with 200 kg of xenon. Unlocks orbital contracts.' },
  { id: 'shield3', name: 'Ablative shield Mk III', cost: 420, icon: 'shield', requires: 'shield2', desc: 'Burns away to carry heat off: 3× the heat of the starter shield.' },
  { id: 'solar2', name: 'Big solar wings', cost: 240, icon: 'solar', requires: 'ion', desc: 'Doubles the ion drive’s power.' },
  { id: 'antigrav', name: 'Antigravity plate', cost: 900, icon: 'antigrav', fiction: true, desc: 'Fictional tech. Lets you cancel up to 99% of gravity low in the atmosphere.' }
];

export const upgradeById = (id) => UPGRADES.find((u) => u.id === id);

// Apply owned upgrades to a mission's params (in place). Starter shield: 250 W/cm², 25 kJ/cm².
export function applyUpgrades(p, owned) {
  const has = (id) => owned.includes(id);
  const heat = has('shield3') ? 3 : has('shield2') ? 1.6 : 1;
  p.limits.heatFlux = 250 * heat;
  p.limits.heatLoad = 25000 * heat;
  if (has('chute2')) { p.vehicle.chute.area *= 1.6; p.vehicle.chute.drogueArea *= 1.6; }
  // The Mars lander keeps its own aeroshell: extra lift there would carry it far past any landing site.
  if (has('trim') && p.vehicle.shape !== 'glider' && p.planet !== 'mars') p.vehicle.liftToDrag = Math.round((p.vehicle.liftToDrag + 0.15) * 100) / 100;
  if (has('ion')) {
    Object.assign(p.vehicle.thruster, { enabled: p.vehicle.thruster.enabled, power: 300000, efficiency: 0.65, exhaustSpeed: 25000 });
    if (has('solar2')) p.vehicle.thruster.power *= 2;
  }
  if (!has('antigrav')) p.vehicle.antigrav = { factor: 0, startAlt: 40000 };
  return p;
}
