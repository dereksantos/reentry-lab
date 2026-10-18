// The research agent's tool-use loop for hosted mode. Provider-neutral: an adapter (anthropic.js, openai.js) runs
// one model turn; this loop runs the tools it asks for and repeats until the model answers. It emits the same events
// the local server streams from Claude Code (see server/agent.js), so the chat panel renders both the same way.
// No DOM or network access of its own, so it is unit-tested in Node (test/agent-loop.test.js).

const MAX_RESULT_CHARS = 30_000;
const clip = (s) => (s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + `\n…[cut at ${MAX_RESULT_CHARS} characters]` : s);

export async function runAgentLoop({ adapter, system, history, userText, tools, signal, send, maxTurns = 40 }) {
  const t0 = Date.now();
  const messages = adapter.start(history, userText);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const usage = { input: 0, output: 0 };
  let text = '';
  let turns = 0;
  let retries = 0;
  let servedBy = null;
  let finished = false;

  const on = {
    text: (delta) => { text += delta; send({ t: 'text', delta }); },
    block: () => { if (text && !text.endsWith('\n\n')) text += '\n\n'; send({ t: 'block' }); },
    status: (s) => send({ t: 'status', text: s }),
    serverTool: (s) => send({ t: 'tool', ...s }),
    serverToolResult: (r) => send({ t: 'tool_result', ...r })
  };
  const note = (s) => on.text(`${text && !text.endsWith('\n\n') ? '\n\n' : ''}_${s}_`);

  while (turns < maxTurns) {
    turns++;
    let r;
    try {
      r = await adapter.turn({ system, messages, tools, signal, on });
    } catch (e) {
      if (e.retryable && retries++ < 2 && !signal?.aborted) { on.status('Retrying the last step…'); continue; }
      throw e;
    }
    retries = 0;
    if (r.usage) { usage.input += r.usage.input; usage.output += r.usage.output; }
    if (r.servedBy) servedBy = r.servedBy;
    if (r.stop === 'pause') continue; // server-side tool (web search) paused a long turn; send it back to continue
    finished = r.stop !== 'tool';
    if (r.stop === 'refusal') note(r.refusal || 'The model declined this request.');
    if (r.stop === 'max_tokens') note('The reply hit the output limit and was cut off.');
    if (finished) break;

    const results = [];
    for (const call of r.toolCalls) {
      const tool = byName.get(call.name);
      const validInput = call.input && typeof call.input === 'object' && !Array.isArray(call.input);
      let desc = { kind: 'other', text: call.name };
      if (tool && validInput) { try { desc = tool.describe(call.input); } catch {} }
      send({ t: 'tool', id: call.id, name: call.name, ...desc });

      let content;
      let isError = false;
      if (!tool) { content = `There is no tool named "${call.name}".`; isError = true; }
      else if (!validInput) { content = 'The tool input was not a valid JSON object. Call the tool again with valid arguments.'; isError = true; }
      else {
        try { content = clip(String(await tool.run(call.input))); }
        catch (e) { content = String(e.message || e); isError = true; }
      }
      send({ t: 'tool_result', id: call.id, name: call.name, isError, preview: content.slice(0, 400) });
      results.push({ id: call.id, content, isError });
    }
    adapter.addResults(messages, results);
    if (signal?.aborted) throw Object.assign(new Error('Stopped.'), { name: 'AbortError' });
  }
  if (!finished) note(`Stopped after ${maxTurns} steps. Ask a follow-up to continue.`);

  return { text, turns, usage, servedBy, durationMs: Date.now() - t0 };
}
