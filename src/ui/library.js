// Runs tab (saved runs from you and the agent, plus what is pinned) and Notebook tab (Markdown notes and chat logs).
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { store, emit, on, cssVar } from '../store.js';
import { isCloud, signedIn } from '../backend.js';
import { escapeHtml, sig } from '../format.js';

let runsEl, nbEl;

export function buildLibrary(runsRoot, nbRoot) {
  runsEl = runsRoot;
  nbEl = nbRoot;
  runsEl.innerHTML = '<div class="list" id="runsList"></div>';
  nbEl.innerHTML = '<div class="list" id="nbList"></div><div class="doc" id="nbDoc" hidden></div>';
  refreshRuns();
  refreshNotebook();
  // Local mode: the server watches notebook/ and pushes changes (the agent writes files directly).
  // Hosted mode: changes come from this page (the agent's tools, Save buttons), announced as 'remote-change'.
  if (!isCloud()) {
    try {
      const es = new EventSource('/api/events');
      es.addEventListener('runs', () => { refreshRuns(); emit('runs-changed'); });
      es.addEventListener('notebook', refreshNotebook);
    } catch {}
  }
  on('remote-change', (what) => (what === 'runs' ? refreshRuns() : refreshNotebook()));
}

const SIGNED_OUT = '<div class="item"><span class="note">Sign in (Settings, top right) to save runs and keep research notes. Everything else works without an account.</span></div>';

function stats(s) {
  if (!s) return '';
  return [
    s.outcome,
    s.peakHeatFlux_W_cm2 != null && `${sig(s.peakHeatFlux_W_cm2)} W/cm²`,
    s.peakG != null && `${sig(s.peakG)} g`,
    s.heatLoad_kJ_cm2 != null && `${sig(s.heatLoad_kJ_cm2)} kJ/cm²`
  ].filter(Boolean).map((x) => `<span>${escapeHtml(x)}</span>`).join('');
}

export function renderPinned() {
  const box = document.getElementById('pinnedBox');
  if (!box) return;
  if (!store.pins.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="intro">Comparing in the view and plots</div>` + store.pins.map((p) => `
    <div class="item"><div class="t"><b><span class="swatch" style="display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle;background:${cssVar(p.color)}"></span>${escapeHtml(p.label)}</b>
    <button class="btn small ghost" data-unpin="${p.id}" type="button">Remove</button></div>
    <div class="stats">${p.result ? stats(briefOf(p.result)) : 'computing…'}</div></div>`).join('');
  box.querySelectorAll('[data-unpin]').forEach((b) => b.addEventListener('click', () => emit('unpin', b.dataset.unpin)));
}

function briefOf(r) {
  const s = r.summary;
  return { outcome: s.outcome, peakHeatFlux_W_cm2: s.peakHeatFlux, peakG: s.peakG, heatLoad_kJ_cm2: s.heatLoad / 1000 };
}

export async function refreshRuns() {
  const list = runsEl.querySelector('#runsList');
  let runs = [];
  if (!signedIn()) { list.innerHTML = `<div id="pinnedBox" style="display:grid;gap:8px"></div>${SIGNED_OUT}`; renderPinned(); return; }
  try { runs = await (await fetch('/api/runs')).json(); } catch {}
  list.innerHTML = `<div id="pinnedBox" style="display:grid;gap:8px"></div>
    <div class="intro">Saved runs. The research agent's runs appear here as it saves them.</div>` +
    (runs.length ? runs.map((r, i) => `
      <div class="item">
        <div class="t"><b>${escapeHtml(r.label || 'Run')}</b><span class="by ${r.createdBy === 'agent' ? 'agent' : ''}">${r.createdBy === 'agent' ? 'agent' : 'you'}</span></div>
        ${r.note ? `<div class="note">${escapeHtml(r.note)}</div>` : ''}
        <div class="stats">${stats(r.summary)}</div>
        <div class="acts"><button class="btn small" data-load="${i}" type="button">Load</button><button class="btn small" data-pin="${i}" type="button">Compare</button>
        <span style="margin-left:auto;font:11px var(--font-mono);color:var(--muted)">${new Date(r.createdAt).toLocaleString('en-US')}</span></div>
      </div>`).join('') : '<div class="item"><span class="note">No saved runs yet. Use “Save run” in the top bar, or ask the agent to save one.</span></div>');
  list.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => emit('load-run', runs[b.dataset.load])));
  list.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', () => emit('pin-run', runs[b.dataset.pin])));
  renderPinned();
}

export async function refreshNotebook() {
  const list = nbEl.querySelector('#nbList');
  let entries = [];
  if (!signedIn()) { list.innerHTML = SIGNED_OUT; return; }
  try { entries = await (await fetch('/api/notebook')).json(); } catch {}
  list.innerHTML = (isCloud()
    ? '<div class="intro">Notes and chat logs are Markdown, saved to your account. Settings has an export.</div>'
    : `<div class="intro">Notes and chat logs live as Markdown files in the project's <code>notebook/</code> folder.</div>`) +
    (entries.length ? entries.map((e) => `
      <div class="item link" data-name="${escapeHtml(e.name)}" tabindex="0" role="button">
        <div class="t"><b>${escapeHtml(e.title)}</b><span class="by ${e.kind === 'chat' ? '' : 'agent'}">${e.kind === 'chat' ? 'chat' : 'note'}</span></div>
        <div class="stats"><span>${new Date(e.mtime).toLocaleString('en-US')}</span></div>
      </div>`).join('') : '<div class="item"><span class="note">Nothing here yet. Save an answer from the Research tab, or ask the agent to write up what you found.</span></div>');
  list.querySelectorAll('[data-name]').forEach((el) => {
    const open = () => openDoc(el.dataset.name);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => e.key === 'Enter' && open());
  });
}

async function openDoc(name) {
  const doc = nbEl.querySelector('#nbDoc'), list = nbEl.querySelector('#nbList');
  const d = await (await fetch('/api/notebook/' + encodeURIComponent(name))).json();
  doc.innerHTML = `<button class="btn small" type="button" id="nbBack">← All notes</button><div class="body">${DOMPurify.sanitize(marked.parse(d.text || ''))}</div>`;
  doc.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  doc.querySelector('#nbBack').addEventListener('click', () => { doc.hidden = true; list.hidden = false; });
  list.hidden = true; doc.hidden = false;
}
