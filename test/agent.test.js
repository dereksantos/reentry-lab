// Hosted-mode research agent: the tool loop, both provider adapters (with fetch stubbed to stream canned SSE),
// the shared simulator commands, and the page fetcher's URL checks. No network, no model.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from '../src/agent/loop.js';
import { openaiAdapter, sse } from '../src/agent/openai.js';
import { anthropicAdapter } from '../src/agent/anthropic.js';
import { runCommand, sweepCommand, rangeValues, baseFromPreset } from '../sim/commands.js';
import { checkTarget } from '../worker/fetch.js';
import { canonicalRedirect } from '../worker/canonical.js';
import { keyProblem } from '../src/agent/providers.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// A Response whose body arrives in the given string chunks (to exercise events split across reads).
const streamResponse = (chunks, headers = {}) => new Response(new ReadableStream({
  start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); }
}), { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } });

const collect = () => { const events = []; return { events, send: (e) => events.push(e) }; };

// ---------- loop ----------
function scriptedAdapter(turns) {
  const seen = [];
  return {
    seen,
    start: (history, userText) => [...history, { role: 'user', content: userText }],
    async turn({ messages, on }) {
      seen.push(structuredClone(messages));
      const t = turns.shift();
      if (t instanceof Error) throw t;
      if (t.text) { on.block(); on.text(t.text); }
      messages.push({ role: 'assistant', content: t.text || '', calls: t.toolCalls });
      return { stop: t.stop, toolCalls: t.toolCalls || [], usage: { input: 10, output: 5 } };
    },
    addResults(messages, results) { messages.push({ role: 'user', results }); }
  };
}

test('loop runs requested tools, returns their results, and ends on a final answer', async () => {
  const adapter = scriptedAdapter([
    { text: 'Let me run it.', stop: 'tool', toolCalls: [{ id: 'a', name: 'echo', input: { x: 1 } }, { id: 'b', name: 'nope', input: {} }, { id: 'c', name: 'echo', input: null }] },
    { text: 'Done: 1.', stop: 'end' }
  ]);
  const tools = [{ name: 'echo', describe: (i) => ({ kind: 'sim', text: `echo ${i.x}` }), run: async (i) => `got ${i.x}` }];
  const { events, send } = collect();
  const r = await runAgentLoop({ adapter, system: 's', history: [{ role: 'user', content: 'earlier' }], userText: 'q', tools, send });
  assert.equal(r.turns, 2);
  assert.equal(r.text, 'Let me run it.\n\nDone: 1.');
  assert.deepEqual(r.usage, { input: 20, output: 10 });
  const results = adapter.seen[1].at(-1).results;
  assert.deepEqual(results.map((x) => [x.id, x.isError]), [['a', false], ['b', true], ['c', true]]);
  assert.equal(results[0].content, 'got 1');
  assert.match(results[1].content, /no tool named "nope"/);
  assert.deepEqual(events.filter((e) => e.t === 'tool').map((e) => e.text), ['echo 1', 'nope', 'echo']);
});

test('loop retries a turn whose tool input could not be parsed, then gives up on real errors', async () => {
  const adapter = scriptedAdapter([Object.assign(new Error('bad json'), { retryable: true }), { text: 'ok', stop: 'end' }]);
  const r = await runAgentLoop({ adapter, system: 's', history: [], userText: 'q', tools: [], send: () => {} });
  assert.equal(r.text, 'ok');
  await assert.rejects(runAgentLoop({ adapter: scriptedAdapter([new Error('401')]), system: 's', history: [], userText: 'q', tools: [], send: () => {} }), /401/);
});

test('loop stops at maxTurns with a note, but not when the last allowed turn finishes', async () => {
  const loopForever = { stop: 'tool', toolCalls: [{ id: 'x', name: 't', input: {} }] };
  const tools = [{ name: 't', describe: () => ({ kind: 'sim', text: 't' }), run: async () => 'r' }];
  const r1 = await runAgentLoop({ adapter: scriptedAdapter([loopForever, loopForever]), system: '', history: [], userText: 'q', tools, send: () => {}, maxTurns: 2 });
  assert.match(r1.text, /Stopped after 2 steps/);
  const r2 = await runAgentLoop({ adapter: scriptedAdapter([loopForever, { text: 'fin', stop: 'end' }]), system: '', history: [], userText: 'q', tools, send: () => {}, maxTurns: 2 });
  assert.equal(r2.text, 'fin');
});

// ---------- OpenAI-compatible adapter ----------
test('sse() reassembles events split across chunks', async () => {
  const res = streamResponse(['data: {"a"', ':1}\n\ndata: [DO', 'NE]\r\n\r\n']);
  const out = [];
  for await (const d of sse(res.body)) out.push(d);
  assert.deepEqual(out, ['{"a":1}', '[DONE]']);
});

test('openai adapter streams text and assembles tool calls from fragments', async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    const ev = (o) => `data: ${JSON.stringify(o)}\n\n`;
    const all = [
      ev({ choices: [{ delta: { content: 'Run' } }] }),
      ev({ choices: [{ delta: { content: 'ning.' } }] }),
      ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'sweep', arguments: '{"vary":[{"pa' } }] } }] }),
      ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"entry.fpa","start":-5,"end":-6,"step":-1}]}' } }] }, finish_reason: 'tool_calls' }] }),
      ev({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }),
      'data: [DONE]\n\n'
    ].join('');
    return streamResponse([all.slice(0, 50), all.slice(50, 177), all.slice(177)]);
  };
  const a = openaiAdapter({ providerId: 'xai', key: 'k', model: 'grok-x' });
  const messages = a.start([{ role: 'assistant', text: 'hi' }], 'question');
  const texts = [];
  const r = await a.turn({ system: 'SYS', messages, tools: [{ name: 'sweep', description: 'd', parameters: { type: 'object' } }], on: { text: (d) => texts.push(d), block() {}, status() {} } });
  assert.equal(request.url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(request.init.headers.authorization, 'Bearer k');
  assert.deepEqual(request.body.messages.slice(0, 2), [{ role: 'system', content: 'SYS' }, { role: 'assistant', content: 'hi' }]);
  assert.equal(request.body.tools[0].function.name, 'sweep');
  assert.equal(texts.join(''), 'Running.');
  assert.equal(r.stop, 'tool');
  assert.deepEqual(r.toolCalls[0].input, { vary: [{ path: 'entry.fpa', start: -5, end: -6, step: -1 }] });
  assert.deepEqual(r.usage, { input: 100, output: 20 });
  a.addResults(messages, [{ id: 'call_1', content: 'table' }]);
  assert.deepEqual(messages.at(-1), { role: 'tool', tool_call_id: 'call_1', content: 'table' });
  assert.equal(messages.at(-2).tool_calls[0].function.name, 'sweep');
});

test('openai adapter turns provider errors into readable messages', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 });
  const a = openaiAdapter({ providerId: 'openai', key: 'bad', model: 'm' });
  await assert.rejects(a.turn({ system: '', messages: [], tools: [], on: {} }), /OpenAI rejected the API key: Incorrect API key provided/);
});

// ---------- Anthropic adapter ----------
test('anthropic adapter sends web tools, eager tool streaming and fallbacks, and parses a tool call', async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    return streamResponse([
      ev('message_start', { message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 50, output_tokens: 1 } } }),
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Checking.' } }),
      ev('content_block_stop', { index: 0 }),
      ev('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'run_simulation', input: {} } }),
      ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"preset":"lunar-return",' } }),
      ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '"changes":{"entry.fpa":-6.2}}' } }),
      ev('content_block_stop', { index: 1 }),
      ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } }),
      ev('message_stop', {})
    ], { 'request-id': 'req_test' });
  };
  const a = anthropicAdapter({ key: 'sk-ant-test', model: 'claude-opus-5-5' });
  const messages = a.start([], 'q');
  const texts = [];
  const on = { text: (d) => texts.push(d), block() {}, status() {}, serverTool() {}, serverToolResult() {} };
  const r = await a.turn({ system: 'SYS', messages, tools: [{ name: 'run_simulation', description: 'd', parameters: { type: 'object', properties: {} } }], on });
  assert.match(request.url, /\/v1\/messages/);
  assert.equal(request.headers.get('x-api-key'), 'sk-ant-test');
  assert.match(request.headers.get('anthropic-beta') || '', /server-side-fallback-2026-07-01/);
  assert.equal(request.body.fallbacks, 'default');
  assert.deepEqual(request.body.output_config, { effort: 'high' });
  assert.deepEqual(request.body.tools.map((t) => t.type || t.name), ['run_simulation', 'web_search_20260209', 'web_fetch_20260209']);
  assert.equal(request.body.tools[0].eager_input_streaming, true);
  assert.equal(request.body.system[0].cache_control.type, 'ephemeral');
  assert.equal(texts.join(''), 'Checking.');
  assert.equal(r.stop, 'tool');
  assert.deepEqual(r.toolCalls, [{ id: 'tu1', name: 'run_simulation', input: { preset: 'lunar-return', changes: { 'entry.fpa': -6.2 } } }]);
  assert.equal(messages.at(-1).role, 'assistant');
  a.addResults(messages, [{ id: 'tu1', content: 'ok' }, { id: 'tu2', content: 'bad', isError: true }]);
  assert.deepEqual(messages.at(-1).content.map((b) => [b.tool_use_id, !!b.is_error]), [['tu1', false], ['tu2', true]]);
});

test('anthropic adapter leaves out fallbacks and dynamic web tools on older models', async () => {
  let body;
  globalThis.fetch = async (url, init) => {
    body = JSON.parse(init.body);
    return streamResponse([`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })}\n\n`, 'event: message_stop\ndata: {"type":"message_stop"}\n\n']);
  };
  const a = anthropicAdapter({ key: 'k', model: 'claude-haiku-4-5' });
  const r = await a.turn({ system: '', messages: a.start([], 'q'), tools: [], on: { text() {}, block() {}, status() {}, serverTool() {}, serverToolResult() {} } });
  assert.equal(r.stop, 'end');
  assert.equal(body.fallbacks, undefined);
  assert.equal(body.output_config, undefined);
  assert.deepEqual(body.tools.map((t) => t.type), ['web_search_20250305', 'web_fetch_20250910']);
});

// ---------- simulator commands ----------
test('runCommand and sweepCommand match direct simulation and respect display units', () => {
  const base = baseFromPreset('lunar-return');
  const { output, params } = runCommand({ params: base.params, label: base.label, sets: ['entry.fpa=-6.2', 'entry.alt=121'] });
  assert.equal(params.entry.fpa, -6.2);
  assert.equal(params.entry.alt, 121000); // km in, metres stored
  assert.ok(output.summary.peakG > 0);
  const s = sweepCommand({ params: base.params, label: base.label, vary: ['entry.fpa=-5.5:-6.5:-0.5'], metrics: ['outcome', 'peakG'] });
  assert.deepEqual(s.rows.map((r) => r['entry.fpa']), [-5.5, -6, -6.5]);
  assert.deepEqual(s.columns, ['entry.fpa', 'outcome', 'peakG']);
  assert.ok(s.rows[2].peakG > s.rows[0].peakG, 'steeper entry pulls more g');
  assert.throws(() => rangeValues('entry.fpa=-5:-6:0'), /start:end:step/);
  assert.throws(() => rangeValues('nope=1:2:1'), /Unknown parameter/);
  assert.throws(() => sweepCommand({ params: base.params, vary: ['entry.fpa=-1:-30:-0.01'] }), /too many/);
});

// ---------- page fetcher ----------
test('fetch proxy accepts public web URLs and refuses everything else', () => {
  for (const ok of ['https://ntrs.nasa.gov/citations/19690029435', 'http://example.com/a?b=c', 'https://example.com:443/']) assert.equal(checkTarget(ok), null, ok);
  for (const bad of ['http://localhost:5317/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/', 'http://10.0.0.1', 'file:///etc/passwd',
    'ftp://example.com', 'https://u:p@example.com', 'http://example.com:8080', 'http://intranet/', 'http://printer.local', 'http://db.internal', 'not a url']) {
    assert.notEqual(checkTarget(bad), null, bad);
  }
});

// ---------- canonical host ----------
test('http, www and workers.dev redirect to https on the canonical host; localhost does not', () => {
  const r = (u, m = 'GET') => canonicalRedirect(new URL(u), m, 'reentrylab.ai');
  assert.equal(r('https://reentrylab.ai/api/health'), null);
  assert.equal(r('http://localhost:8787/'), null);
  const a = r('https://www.reentrylab.ai/assets/x.js?v=1');
  assert.equal(a.status, 301);
  assert.equal(a.headers.get('location'), 'https://reentrylab.ai/assets/x.js?v=1');
  const b = r('https://reentry-lab.santos-derek.workers.dev/api/runs', 'POST');
  assert.equal(b.status, 308);
  assert.equal(b.headers.get('location'), 'https://reentrylab.ai/api/runs');
  assert.equal(canonicalRedirect(new URL('https://x.workers.dev/'), 'GET', ''), null);
  const c = r('http://reentrylab.ai/path');
  assert.equal(c.status, 301);
  assert.equal(c.headers.get('location'), 'https://reentrylab.ai/path');
  assert.equal(canonicalRedirect(new URL('http://127.0.0.1:8787/'), 'GET', 'reentrylab.ai'), null);
  assert.equal(canonicalRedirect(new URL('http://reentrylab.ai/'), 'GET', ''), null, 'empty CANONICAL_HOST (wrangler dev) turns redirects off');
});

// ---------- key checks ----------
test('pasted text that is not an API key is refused; an unusual prefix only warns', () => {
  assert.match(keyProblem('openrouter', 'sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder').error, /isn't an API key/);
  assert.match(keyProblem('anthropic', 'sk-ant-abc•').error, /isn't an API key/);
  assert.match(keyProblem('openrouter', 'sk-proj-abc').warning, /usually start with “sk-or-”/);
  assert.equal(keyProblem('openrouter', 'sk-or-v1-abc123'), null);
  assert.equal(keyProblem('xai', 'xai-abc'), null);
  assert.equal(keyProblem('openrouter', ''), null);
});
