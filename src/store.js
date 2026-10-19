// Tiny state store with named events. Everything in the app reads and writes through here.
import { PRESETS, clone, normalizeParams } from '../sim/index.js';

const saved = (() => { try { return JSON.parse(localStorage.getItem('reentry-lab:v1') || '{}'); } catch { return {}; } })();

export const store = {
  presetKey: saved.presetKey || 'lunar-return',
  // Saved settings may predate newer parameters (such as the thruster); fill those in from the defaults.
  params: saved.params ? normalizeParams(saved.params) : clone(PRESETS.find((p) => p.key === (saved.presetKey || 'lunar-return')).params),
  result: null,
  pins: [],                 // [{ id, label, color, params, result }]
  playhead: 0,
  playing: false,
  speed: 20,
  exag: saved.exag || 8,
  cam: 'orbit',
  sessionId: saved.sessionId || null,
  model: saved.model || '',
  includeContext: saved.includeContext !== false
};

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  for (const fn of listeners.get(evt) || []) {
    try { fn(data); } catch (e) { console.error(`[${evt}]`, e); }
  }
}

export function persist() {
  try {
    localStorage.setItem('reentry-lab:v1', JSON.stringify({
      presetKey: store.presetKey, params: store.params, exag: store.exag,
      sessionId: store.sessionId, model: store.model, includeContext: store.includeContext
    }));
  } catch {}
}

export const PIN_COLORS = ['--pin-a', '--pin-b', '--pin-c'];
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function toast(text, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), ms);
}
