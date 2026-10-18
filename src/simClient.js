// Runs simulations in a Web Worker so dragging a slider never blocks the 3D view.
const worker = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' });
let nextId = 1;
const pending = new Map();
worker.onmessage = (e) => {
  const { id, result, error } = e.data;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (error) p.reject(new Error(error)); else p.resolve(result);
};
export function simulateAsync(params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, params: JSON.parse(JSON.stringify(params)) });
  });
}

// Research-agent commands ('run' | 'sweep', see sim/commands.js), off the main thread like everything else.
export function simCommand(cmd, args) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, cmd, args: JSON.parse(JSON.stringify(args)) });
  });
}

// Latest-wins runner for the live simulation: while one run is in flight, only the newest request is kept.
let busy = false, queued = null;
export function runLatest(params, onResult, onBusy) {
  queued = params;
  if (busy) return;
  const go = async () => {
    const p = queued; queued = null; busy = true;
    const timer = setTimeout(() => onBusy && onBusy(true), 150);
    try { onResult(await simulateAsync(p), p); }
    catch (e) { console.error(e); }
    finally {
      clearTimeout(timer); busy = false; onBusy && onBusy(false);
      if (queued) go();
    }
  };
  go();
}
