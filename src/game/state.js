// Campaign progress, kept in this browser: credits, upgrades owned, best stars per contract, and knob settings.
import { MISSIONS } from './missions.js';
import { upgradeById } from './upgrades.js';

const KEY = 'reentry-lab:campaign:v1';
const fresh = () => ({ credits: 150, owned: [], best: {}, knobs: {}, flights: 0 });

export const game = (() => {
  try { return { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return fresh(); }
})();

export function saveGame() {
  try { localStorage.setItem(KEY, JSON.stringify(game)); } catch {}
}

export function resetGame() {
  Object.assign(game, fresh());
  saveGame();
}

export const owns = (id) => game.owned.includes(id);
export const unlocked = (mission) => !mission.requires || owns(mission.requires);

export function canBuy(upgrade) {
  if (owns(upgrade.id)) return { ok: false, why: 'Owned' };
  if (upgrade.requires && !owns(upgrade.requires)) return { ok: false, why: `Needs ${upgradeById(upgrade.requires).name}` };
  if (game.credits < upgrade.cost) return { ok: false, why: `${upgrade.cost - game.credits} more credits` };
  return { ok: true };
}

export function buy(upgrade) {
  if (!canBuy(upgrade).ok) return false;
  game.credits -= upgrade.cost;
  game.owned.push(upgrade.id);
  saveGame();
  return true;
}

// Pay out for a flight: the full reward the first time a contract is completed, plus a quarter of it for each
// new star beyond the best so far. Returns what was earned.
export function recordFlight(mission, stars) {
  game.flights++;
  const prev = game.best[mission.id] || 0;
  let earned = 0;
  if (stars > prev) {
    if (prev === 0) earned += mission.reward;
    earned += Math.round(0.25 * mission.reward * (stars - Math.max(prev, 1)));
    game.best[mission.id] = stars;
  }
  game.credits += earned;
  saveGame();
  return { earned, prev };
}

export const totalStars = () => MISSIONS.reduce((n, m) => n + (game.best[m.id] || 0), 0);
