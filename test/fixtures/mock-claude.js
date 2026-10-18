#!/usr/bin/env node
// Stand-in for `claude -p --output-format stream-json` used to test the app's agent bridge without a real model.
if (process.argv.includes('--version')) { console.log('9.9.9 (Mock Claude Code)'); process.exit(0); }
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', async () => {
  const sid = (process.argv.includes('--resume') ? process.argv[process.argv.indexOf('--resume') + 1] : 'mock-session-0001');
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'mock' });
  const say = async (text) => {
    out({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', content_block: { type: 'text' } } });
    for (const w of text.match(/.{1,12}/gs)) { out({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: w } } }); await wait(15); }
  };
  await say(`Got your question (${input.includes('<app_context>') ? 'with' : 'without'} app context). Let me run a sweep.`);
  out({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'node sim/cli.js sweep --context --vary entry.fpa=-5:-8:-1' } }] } });
  await wait(100);
  out({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'table...' }] } });
  out({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't2', name: 'WebSearch', input: { query: 'Apollo 4 entry peak heating' } }] } });
  await say('\n\n| fpa | peak g |\n|---|---|\n| -6 | 9.3 |\n| -7 | 10.3 |\n\nTry a steeper entry:\n\n```sim-params\n{ "label": "Steeper entry", "entry.fpa": -7.0 }\n```\n\n**Sources**\n- [NTRS](https://ntrs.nasa.gov)');
  out({ type: 'result', subtype: 'success', is_error: false, result: 'final', session_id: sid, total_cost_usd: 0.0123, duration_ms: 1500, num_turns: 3 });
});
