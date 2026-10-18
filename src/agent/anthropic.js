// Claude adapter for the in-browser research agent (Anthropic Messages API via the official SDK).
// Web search and web fetch are Anthropic server tools, so Claude researches without the page-fetch proxy.

import Anthropic from '@anthropic-ai/sdk';

// Feature gates by model family. Unknown or older models simply get fewer extras.
const DYNAMIC_WEB = /claude-(opus-(4-[6-9]|5)|sonnet-(4-6|5))/;       // web_search/web_fetch _20260209
const EFFORT = /claude-(opus-(4-[5-9]|5)|sonnet-(4-6|5)|haiku-5|fable|mythos)/;
const FALLBACKS = /claude-(fable-5-1|opus-5-5|opus-5(?!-)|sonnet-5-5)/; // server-side refusal fallback, "default" routing

export function anthropicAdapter({ key, model }) {
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });

  return {
    label: model,

    start(history, userText) {
      const messages = history.map((m) => ({ role: m.role, content: m.text }));
      messages.push({ role: 'user', content: userText });
      return messages;
    },

    async turn({ system, messages, tools, signal, on }) {
      const dynamic = DYNAMIC_WEB.test(model);
      const params = {
        model,
        max_tokens: 64000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: [
          ...tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters, eager_input_streaming: true })),
          { type: dynamic ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 8 },
          { type: dynamic ? 'web_fetch_20260209' : 'web_fetch_20250910', name: 'web_fetch', max_uses: 8 }
        ],
        messages
      };
      if (EFFORT.test(model)) params.output_config = { effort: 'high' };
      if (FALLBACKS.test(model)) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }

      const stream = client.beta.messages.stream(params, { signal });
      stream.on('streamEvent', (ev) => {
        if (ev.type === 'content_block_start') {
          const b = ev.content_block;
          if (b.type === 'text') on.block();
          else if (b.type === 'thinking') on.status('Thinking…');
          else if (b.type === 'tool_use') on.status(`Preparing ${b.name.replace(/_/g, ' ')}…`);
        }
      });
      stream.on('text', (delta) => on.text(delta));
      stream.on('contentBlock', (b) => {
        if (b.type === 'server_tool_use') on.serverTool(describeServerTool(b));
        if (b.type === 'web_search_tool_result' || b.type === 'web_fetch_tool_result') {
          const failed = b.content && !Array.isArray(b.content) && /error/.test(b.content.type || '');
          on.serverToolResult({ id: b.tool_use_id, isError: !!failed });
        }
      });

      let message;
      try {
        message = await stream.finalMessage();
      } catch (e) {
        throw friendlyError(e);
      }
      messages.push({ role: 'assistant', content: message.content });

      const toolCalls = message.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }));
      const stop = {
        end_turn: 'end', stop_sequence: 'end', tool_use: 'tool', pause_turn: 'pause', refusal: 'refusal', max_tokens: 'max_tokens'
      }[message.stop_reason] || 'end';
      const served = (message.usage?.iterations || []).some((it) => it.type === 'fallback_message') ? message.model : null;
      return {
        stop: stop === 'end' && toolCalls.length ? 'tool' : stop,
        toolCalls,
        usage: { input: (message.usage?.input_tokens || 0) + (message.usage?.cache_read_input_tokens || 0) + (message.usage?.cache_creation_input_tokens || 0), output: message.usage?.output_tokens || 0 },
        servedBy: served,
        refusal: message.stop_reason === 'refusal' ? message.stop_details?.explanation || 'The model declined this request.' : null
      };
    },

    addResults(messages, results) {
      // All results of one turn go back in a single user message.
      messages.push({
        role: 'user',
        content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) }))
      });
    }
  };
}

function describeServerTool(b) {
  if (b.name === 'web_search') return { id: b.id, name: 'WebSearch', kind: 'search', text: `Searching the web for “${b.input?.query || ''}”` };
  if (b.name === 'web_fetch') {
    let host = b.input?.url || '';
    try { host = new URL(b.input.url).host; } catch {}
    return { id: b.id, name: 'WebFetch', kind: 'read', text: `Reading ${host}`, url: b.input?.url };
  }
  return { id: b.id, name: b.name, kind: 'other', text: b.name };
}

function friendlyError(e) {
  if (e instanceof Anthropic.APIUserAbortError || e?.name === 'AbortError') return e;
  if (e instanceof Anthropic.AuthenticationError) return new Error('Anthropic rejected the API key. Check it in Settings.');
  if (e instanceof Anthropic.PermissionDeniedError) return new Error(`Anthropic denied the request: ${e.message}`);
  if (e instanceof Anthropic.NotFoundError) return new Error(`Anthropic does not know this model, or your key can't use it: ${e.message}`);
  if (e instanceof Anthropic.RateLimitError) return new Error('Anthropic rate limit reached. Wait a moment and try again.');
  if (e instanceof Anthropic.BadRequestError) return new Error(`Anthropic rejected the request: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionError) return new Error('Could not reach the Anthropic API. Check your connection.');
  if (e instanceof Anthropic.APIError) return new Error(`Anthropic API error ${e.status ?? ''}: ${e.message}`);
  // Anything else is the SDK failing to parse a streamed tool input; the loop retries the turn.
  return Object.assign(new Error(`Could not read the model's tool call: ${e.message}`), { retryable: true });
}
