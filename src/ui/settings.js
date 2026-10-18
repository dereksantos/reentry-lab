// Settings dialog for the hosted version: account (sign in/out, export, delete) and the research agent's model
// provider, API key and model. Keys never leave this browser except in requests to the chosen provider.
import { escapeHtml } from '../format.js';
import { toast, emit } from '../store.js';
import { getHealth, api } from '../backend.js';
import {
  PROVIDERS, agentSettings, saveSettings, getKey, setKey, setRemember, forgetAllKeys,
  currentProvider, currentModel, listModels, connectOpenRouter
} from '../agent/providers.js';

const modelCache = {};

export function openSettings() {
  const health = getHealth() || {};
  const dlg = document.createElement('dialog');
  dlg.className = 'settings';
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); emit('agent-settings'); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  const render = () => {
    const prov = currentProvider();
    const p = PROVIDERS[prov];
    const key = getKey(prov);
    const user = health.user;
    const signIn = health.signIn || {};
    const anySignIn = signIn.github || signIn.google || signIn.dev;
    dlg.innerHTML = `
      <form method="dialog" class="settings-body">
        <div class="settings-head"><b>Settings</b><button class="btn small ghost" value="close" aria-label="Close">✕</button></div>

        <section>
          <h4>Account</h4>
          ${user
            ? `<p>Signed in as <b>${escapeHtml(user.name)}</b> (${escapeHtml(user.id)}). Your runs, notes and chats are saved to your account.</p>
               <div class="row"><button class="btn small" type="button" data-a="export">Export my data</button><button class="btn small" type="button" data-a="logout">Sign out</button><button class="btn small danger" type="button" data-a="delete">Delete my data</button></div>`
            : `<p>Sign in to save runs, research notes and chats. The simulator and the research agent work without an account.</p>
               <div class="row">${signIn.github ? '<a class="btn" href="/auth/login/github">Sign in with GitHub</a>' : ''}${signIn.google ? '<a class="btn" href="/auth/login/google">Sign in with Google</a>' : ''}${signIn.dev ? '<a class="btn" href="/auth/dev">Dev sign-in (localhost)</a>' : ''}${anySignIn ? '' : '<span class="muted">Sign-in is not set up on this server.</span>'}</div>`}
        </section>

        <section>
          <h4>Research agent model</h4>
          <p class="muted">Bring your own API key. It is stored only in this browser and sent only to ${escapeHtml(p.label.replace(/ \(.*\)$/, ''))}, which bills you directly. This site never sees it.</p>
          <label class="field">Provider
            <select id="setProvider">${Object.entries(PROVIDERS).map(([id, x]) => `<option value="${id}" ${id === prov ? 'selected' : ''}>${escapeHtml(x.label)}${getKey(id) ? ' ✓' : ''}</option>`).join('')}</select>
          </label>
          ${p.oauth ? `<div class="row"><button class="btn primary small" type="button" data-a="openrouter">${key ? 'Reconnect' : 'Connect'} with OpenRouter</button><span class="muted">or paste a key below</span></div>` : ''}
          <label class="field">API key <a href="${p.keyUrl}" target="_blank" rel="noopener noreferrer">get one</a>
            <span class="row"><input id="setKey" type="password" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(p.keyHint)}" value="${key ? '••••••••••••' : ''}">
            ${key ? '<button class="btn small" type="button" data-a="clearkey">Remove</button>' : ''}</span>
          </label>
          <label class="field">Model
            <span class="row"><select id="setModel"><option value="${escapeHtml(currentModel())}">${escapeHtml(currentModel() || 'Load the model list →')}</option></select>
            <button class="btn small" type="button" data-a="models" ${key || prov === 'openrouter' ? '' : 'disabled'}>Load models</button></span>
          </label>
          ${prov === 'openrouter' ? `<label class="toggle"><input type="checkbox" id="setWeb" ${agentSettings.openrouterWeb ? 'checked' : ''}> Web search (OpenRouter's web plugin, billed by OpenRouter)</label>` : ''}
          <p class="muted">Web research: ${p.webSearch === 'built in' ? 'built-in web search and page reading.' : p.webSearch === 'optional' ? 'optional web search (above); otherwise the agent reads pages you or it name, when you are signed in.' : 'the agent reads pages you or it name, when you are signed in (no search engine).'}</p>
          <label class="toggle"><input type="checkbox" id="setRemember" ${agentSettings.remember ? 'checked' : ''}> Remember keys on this device (otherwise they are forgotten when you close the tab)</label>
          <div class="row"><button class="btn small" type="button" data-a="forget">Forget all keys</button></div>
        </section>

        <section class="about">
          ${health.supportUrl ? `<a class="btn primary" href="${escapeHtml(health.supportUrl)}" target="_blank" rel="noopener noreferrer">♥ Support this project</a>` : ''}
          ${health.sourceUrl ? `<a href="${escapeHtml(health.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source code (open source)</a>` : ''}
        </section>
      </form>`;

    const q = (s) => dlg.querySelector(s);
    q('#setProvider').addEventListener('change', (e) => { agentSettings.provider = e.target.value; saveSettings(); render(); });
    const keyInput = q('#setKey');
    keyInput.addEventListener('focus', () => { if (keyInput.value.startsWith('•')) keyInput.value = ''; });
    keyInput.addEventListener('change', () => {
      const v = keyInput.value.trim();
      if (!v || v.startsWith('•')) return;
      setKey(prov, v);
      delete modelCache[prov];
      toast('Key saved in this browser');
      render();
      loadModels(prov, v);
    });
    q('#setModel').addEventListener('change', (e) => { agentSettings.models[prov] = e.target.value; saveSettings(); });
    q('#setWeb')?.addEventListener('change', (e) => { agentSettings.openrouterWeb = e.target.checked; saveSettings(); });
    q('#setRemember').addEventListener('change', (e) => setRemember(e.target.checked));
    dlg.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => action(b.dataset.a, prov)));
    if (modelCache[prov]) fillModels(prov);
  };

  const fillModels = (prov) => {
    const sel = dlg.querySelector('#setModel');
    if (!sel) return;
    const ids = modelCache[prov];
    const cur = currentModel();
    sel.innerHTML = (cur && !ids.includes(cur) ? [cur, ...ids] : ids).map((id) => `<option ${id === cur ? 'selected' : ''}>${escapeHtml(id)}</option>`).join('');
    if (!cur && ids.length) { agentSettings.models[prov] = sel.value; saveSettings(); }
  };

  const loadModels = async (prov, key) => {
    const btn = dlg.querySelector('[data-a=models]');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      modelCache[prov] = await listModels(prov, key);
      fillModels(prov);
    } catch (e) {
      toast(e.message, 5000);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Load models'; }
    }
  };

  const action = async (a, prov) => {
    if (a === 'models') return loadModels(prov, getKey(prov));
    if (a === 'clearkey') { setKey(prov, ''); delete modelCache[prov]; toast('Key removed'); return render(); }
    if (a === 'forget') { forgetAllKeys(); toast('All keys removed from this browser'); return render(); }
    if (a === 'openrouter') return connectOpenRouter();
    if (a === 'export') { location.href = '/api/account/export'; return; }
    if (a === 'logout') {
      await fetch('/auth/logout', { method: 'POST' });
      location.reload();
      return;
    }
    if (a === 'delete') {
      // Two clicks: the first arms the button for five seconds.
      const btn = dlg.querySelector('[data-a=delete]');
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = 'Click again to delete all runs, notes and chats';
        setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Delete my data'; } }, 5000);
        return;
      }
      try { await api('/api/account', { method: 'DELETE' }); location.reload(); } catch (e) { toast(e.message, 4000); }
    }
  };

  render();
  dlg.showModal();
}
