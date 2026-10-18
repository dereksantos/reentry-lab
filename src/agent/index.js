// Hosted-mode research agent: one chat turn, run in the browser with the user's own key.
// Emits the same events as POST /api/agent on the local server (request/init/block/text/tool/tool_result/status/done/error).

import { PROVIDERS, agentSettings, currentProvider, currentModel, getKey } from './providers.js';
import { buildTools } from './tools.js';
import { systemPrompt } from './prompt.js';
import { runAgentLoop } from './loop.js';
import { api, signedIn } from '../backend.js';

export function cloudAgentReady() {
  const provider = currentProvider();
  if (!getKey(provider)) return { ok: false, reason: `Add your ${PROVIDERS[provider].label} API key in Settings to start.` };
  if (!currentModel()) return { ok: false, reason: `Choose a ${PROVIDERS[provider].label} model in Settings.` };
  return { ok: true, label: `${currentModel()} · ${PROVIDERS[provider].label.replace(/ \(.*\)$/, '')}` };
}

// history: earlier messages of this conversation as [{ role, text }] (text only; tool calls are not replayed).
export async function runCloudAgent({ message, context, history, sessionId, signal, send, getContext }) {
  const providerId = currentProvider();
  const p = PROVIDERS[providerId];
  const model = currentModel();
  const key = getKey(providerId);
  if (!key) return send({ t: 'error', message: `No ${p.label} API key is saved in this browser. Add it in Settings.` });
  const webSearch = providerId === 'openrouter' && agentSettings.openrouterWeb;
  // Loaded on first use, so the Anthropic SDK isn't in the main bundle (local mode never needs it).
  const adapter = p.kind === 'anthropic'
    ? (await import('./anthropic.js')).anthropicAdapter({ key, model })
    : (await import('./openai.js')).openaiAdapter({ providerId, key, model, webSearch });
  const webTools = p.kind === 'anthropic' || webSearch ? 'builtin' : signedIn() ? 'fetch' : 'none';
  const tools = buildTools({ getContext, signedIn, fetchTool: webTools === 'fetch' });
  const system = systemPrompt({ signedIn: signedIn(), webTools });
  const userText = context
    ? `<app_context>\nWhat the user currently has loaded in Reentry Lab (get_app_state has the full detail):\n${JSON.stringify(context)}\n</app_context>\n\n${message}`
    : message;

  const id = sessionId || crypto.randomUUID();
  send({ t: 'init', sessionId: id, model });
  const save = (entry) => (signedIn() ? api(`/api/threads/${id}/messages`, { method: 'POST', body: entry }).catch(() => {}) : Promise.resolve());
  await save({ role: 'user', text: message });

  try {
    const r = await runAgentLoop({ adapter, system, history, userText, tools, signal, send });
    if (r.text) await save({ role: 'assistant', text: r.text, model: r.servedBy || model });
    send({ t: 'done', sessionId: id, durationMs: r.durationMs, turns: r.turns, usage: r.usage, servedBy: r.servedBy });
  } catch (e) {
    if (signal.aborted || e.name === 'AbortError' || e.name === 'APIUserAbortError') send({ t: 'done', sessionId: id, cancelled: true });
    else send({ t: 'error', message: e.message || String(e) });
  }
}
