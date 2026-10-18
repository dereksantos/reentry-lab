// Model providers for the in-browser research agent, and where their keys live.
// Keys are kept in this browser only (localStorage when "remember" is on, otherwise sessionStorage) and are sent
// only to the provider's own API. The OpenRouter connection uses OpenRouter's OAuth PKCE flow, entirely client-side.

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)', kind: 'anthropic', defaultModel: 'claude-opus-5-5',
    keyUrl: 'https://platform.claude.com/settings/keys', keyHint: 'sk-ant-…', keyPrefix: 'sk-ant-', webSearch: 'built in'
  },
  openai: {
    label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…', keyPrefix: 'sk-', webSearch: null
  },
  xai: {
    label: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai/', keyHint: 'xai-…', keyPrefix: 'xai-', webSearch: null
  },
  gemini: {
    label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/app/apikey', keyHint: 'AIza…', keyPrefix: 'AIza', webSearch: null, noStreamUsage: true
  },
  openrouter: {
    label: 'OpenRouter (many models)', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/settings/keys', keyHint: 'sk-or-…', keyPrefix: 'sk-or-', webSearch: 'optional', oauth: true
  }
};

const SETTINGS_KEY = 'reentry-lab:agent';
const KEYS_KEY = 'reentry-lab:keys';

// Storage can be missing (tests in Node) or throw (privacy modes); both just mean "nothing saved".
const local = () => globalThis.localStorage;
const session = () => globalThis.sessionStorage;
function read(storage, key) {
  try { return JSON.parse(storage.getItem(key) || '{}'); } catch { return {}; }
}
function write(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch {}
}

export const agentSettings = Object.assign(
  { provider: 'anthropic', models: {}, remember: true, openrouterWeb: false },
  read(local(), SETTINGS_KEY)
);
export function saveSettings() { write(local(), SETTINGS_KEY, agentSettings); }

const keyStore = () => (agentSettings.remember ? local() : session());
export function getKey(provider) {
  return read(local(), KEYS_KEY)[provider] || read(session(), KEYS_KEY)[provider] || '';
}
export function setKey(provider, key) {
  for (const s of [local(), session()]) {
    const all = read(s, KEYS_KEY);
    delete all[provider];
    if (key && s === keyStore()) all[provider] = key;
    write(s, KEYS_KEY, all);
  }
}
// Move keys when the "remember on this device" choice changes.
export function setRemember(on) {
  const keys = Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, getKey(p)]));
  agentSettings.remember = on;
  saveSettings();
  for (const [p, k] of Object.entries(keys)) setKey(p, k);
}
export function forgetAllKeys() {
  for (const s of [local(), session()]) { try { s.removeItem(KEYS_KEY); } catch {} }
}

// Catch pasted text that isn't a key (a command, a sentence) before it's saved and sent as a credential.
// A key with an unexpected prefix is only a warning: providers occasionally introduce new key formats.
export function keyProblem(providerId, key) {
  const p = PROVIDERS[providerId];
  if (!key) return null;
  if (/\s/.test(key) || /[^\x21-\x7e]/.test(key)) return { error: `That isn't an API key: keys have no spaces or special characters. Paste just the ${p.label.replace(/ \(.*\)$/, '')} key.` };
  if (p.keyPrefix && !key.startsWith(p.keyPrefix)) return { warning: `${p.label.replace(/ \(.*\)$/, '')} keys usually start with “${p.keyPrefix}”. Double-check you pasted the right one.` };
  return null;
}

export const currentProvider = () => PROVIDERS[agentSettings.provider] ? agentSettings.provider : 'anthropic';
export const currentModel = () => agentSettings.models[currentProvider()] || PROVIDERS[currentProvider()].defaultModel || '';

// ---------- model lists (fetched with the user's key, straight from the provider) ----------
const HIDE = /embed|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|davinci|babbage|imagen|veo|aqa|-search-|computer-use/i;

export async function listModels(providerId, key) {
  const p = PROVIDERS[providerId];
  if (p.kind === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const ids = [];
    for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
    return ids;
  }
  const r = await fetch(`${p.baseUrl}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
  if (!r.ok) throw new Error(await errorText(r, providerId));
  const data = await r.json();
  let models = data.data || [];
  // OpenRouter says which models accept tools; the agent can't work without them. Batch variants don't stream.
  if (providerId === 'openrouter') models = models.filter((m) => (m.supported_parameters || []).includes('tools') && !String(m.id).endsWith(':batch'));
  return models.map((m) => String(m.id).replace(/^models\//, '')).filter((id) => !HIDE.test(id)).sort();
}

export async function errorText(r, providerId) {
  const body = await r.text().catch(() => '');
  let msg = '';
  try { const j = JSON.parse(body); msg = j.error?.message || j.error || j.message || ''; } catch { msg = body.slice(0, 300); }
  if (r.status === 401 || r.status === 403) return `${PROVIDERS[providerId].label} rejected the API key${msg ? `: ${msg}` : '.'}`;
  if (/tool use|tool calling|tools? (is|are) not supported|does not support tools|support tool/i.test(msg)) return `${PROVIDERS[providerId].label}: this model can't use tools, which the research agent needs. Pick another model in Settings. (${msg})`;
  if (r.status === 429) return `${PROVIDERS[providerId].label} rate limit or quota reached${msg ? `: ${msg}` : '.'}`;
  return `${PROVIDERS[providerId].label} error ${r.status}${msg ? `: ${msg}` : ''}`;
}

// ---------- OpenRouter OAuth (PKCE): https://openrouter.ai/docs/use-cases/oauth-pkce ----------
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const VERIFIER_KEY = 'reentry-lab:openrouter-verifier';

export async function connectOpenRouter() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const callback = `${location.origin}/?openrouter=callback`;
  location.href = `https://openrouter.ai/auth?${new URLSearchParams({ callback_url: callback, code_challenge: challenge, code_challenge_method: 'S256' })}`;
}

// Called on page load: finishes the OpenRouter flow if we were just redirected back. Returns true when a key was stored.
export async function finishOpenRouter() {
  const params = new URLSearchParams(location.search);
  if (params.get('openrouter') !== 'callback') return false;
  const code = params.get('code');
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  history.replaceState(null, '', location.pathname);
  if (!code) return false;
  // The verifier lives in this tab's sessionStorage, so a connect started on another address (or tab) can't finish here.
  if (!verifier) throw new Error('The OpenRouter connection did not finish. Open Settings and click Connect with OpenRouter again.');
  const r = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' })
  });
  if (!r.ok) throw new Error(await errorText(r, 'openrouter'));
  const { key } = await r.json();
  if (!key) return false;
  setKey('openrouter', key);
  agentSettings.provider = 'openrouter';
  saveSettings();
  return true;
}
