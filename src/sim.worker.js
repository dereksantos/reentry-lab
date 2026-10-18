import { simulate } from '../sim/simulate.js';
import { runCommand, sweepCommand } from '../sim/commands.js';

// Two kinds of jobs: { params } runs one simulation for the views (full samples, transferred as typed arrays);
// { cmd: 'run' | 'sweep', args } runs a research-agent command (compact output only, see sim/commands.js).
self.onmessage = (e) => {
  const { id, params, cmd, args } = e.data;
  try {
    if (cmd === 'run') {
      const { params: p, result, output } = runCommand(args);
      self.postMessage({ id, result: { params: p, output, model: result.model } });
      return;
    }
    if (cmd === 'sweep') {
      self.postMessage({ id, result: sweepCommand(args) });
      return;
    }
    const t0 = performance.now();
    const r = simulate(params);
    const transfer = [];
    for (const c of r.columns) {
      const a = Float64Array.from(r.samples[c]);
      r.samples[c] = a;
      transfer.push(a.buffer);
    }
    r.computeMs = performance.now() - t0;
    self.postMessage({ id, result: r }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
