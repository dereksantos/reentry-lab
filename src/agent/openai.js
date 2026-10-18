// Adapter for providers that speak the OpenAI Chat Completions format: OpenAI, xAI (Grok), Google Gemini
// (its OpenAI-compatible endpoint) and OpenRouter. Streams Server-Sent Events with plain fetch.

import { PROVIDERS, errorText } from './providers.js';

export function openaiAdapter({ providerId, key, model, webSearch }) {
  const p = PROVIDERS[providerId];

  return {
    label: model,

    start(history, userText) {
      const messages = history.map((m) => ({ role: m.role, content: m.text }));
      messages.push({ role: 'user', content: userText });
      return messages;
    },

    async turn({ system, messages, tools, signal, on }) {
      const body = {
        model,
        stream: true,
        messages: [{ role: 'system', content: system }, ...messages],
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
      };
      if (!p.noStreamUsage) body.stream_options = { include_usage: true };
      if (providerId === 'openrouter' && webSearch) body.plugins = [{ id: 'web' }];
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
      if (providerId === 'openrouter') Object.assign(headers, { 'HTTP-Referer': location.origin, 'X-Title': 'Reentry Lab' });

      let res;
      try {
        res = await fetch(`${p.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw new Error(`Could not reach ${p.label}. Check your connection.`);
      }
      if (!res.ok || !res.body) throw new Error(await errorText(res, providerId));

      let text = '';
      let finish = null;
      let usage = null;
      let started = false;
      const calls = []; // by index: { id, name, args }
      for await (const data of sse(res.body)) {
        if (data === '[DONE]') break;
        let chunk;
        try { chunk = JSON.parse(data); } catch { continue; }
        if (chunk.error) throw new Error(`${p.label}: ${chunk.error.message || JSON.stringify(chunk.error)}`);
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const d = choice.delta || {};
        if (d.reasoning_content || d.reasoning) on.status('Thinking…');
        if (d.content) {
          if (!started) { on.block(); started = true; }
          text += d.content;
          on.text(d.content);
        }
        for (const tc of d.tool_calls || []) {
          const i = tc.index ?? calls.length;
          calls[i] ||= { id: '', name: '', args: '' };
          if (tc.id) calls[i].id = tc.id;
          if (tc.function?.name) { calls[i].name += tc.function.name; on.status(`Preparing ${calls[i].name.replace(/_/g, ' ')}…`); }
          if (tc.function?.arguments) calls[i].args += tc.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }

      const toolCalls = calls.filter(Boolean).map((c, i) => {
        let input = null;
        try { input = c.args ? JSON.parse(c.args) : {}; } catch {}
        return { id: c.id || `call_${Date.now()}_${i}`, name: c.name, input, rawArgs: c.args };
      });
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.rawArgs || '{}' } })) } : {})
      });
      const stop = toolCalls.length ? 'tool' : finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'end';
      return {
        stop,
        toolCalls,
        usage: usage ? { input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0 } : null,
        refusal: stop === 'refusal' ? `${p.label} stopped the reply with its content filter.` : null
      };
    },

    addResults(messages, results) {
      for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `Error: ${r.content}` : r.content });
    }
  };
}

// Yields the data field of each Server-Sent Event.
export async function* sse(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const event = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (data) yield data;
    }
  }
}
