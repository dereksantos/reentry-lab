# Reentry Lab

3D atmospheric-entry simulator (Vite + three.js front end) with a research agent. Two backends from one front end: a plain Node server with a Claude Code agent (local), and a Cloudflare Worker where the agent runs in the browser with the user's own model key (hosted). See README.md and DEPLOY.md. MIT licensed, public repo.

## Layout
- `sim/` — physics core, plain ES modules with no dependencies, shared by browser (via a Web Worker), CLI and tests. `simulate.js` is the integrator and dynamics; `params.js` is the parameter schema the UI, CLI and agents all use; `presets.js` holds the missions; `commands.js` is run/sweep/describe/list shared by `cli.js` and the hosted agent's tools.
- `server/index.js` — localhost-only HTTP server: Vite middleware in dev, `dist/` in prod, `/api/*` routes. `server/agent.js` spawns `claude -p` with stream-json output and normalizes events for the browser.
- `src/` — `main.js` wires everything and owns the floating-panel layout (collapse tabs, focus view, `Globe.setInsets` so the camera frames the open area); `three/globe.js` (main view), `three/vehicleView.js` (inset camera, rendered with scissor on the same renderer; `buildBody` is the shared vehicle geometry), `three/snapshots.js` (vehicle pictures for the Hangar, rendered once offscreen), `ui/*` panels including `ui/hangar.js` (mission picker) and `ui/ride.js` (ride-along window view, SVG), `audio/entrySound.js` (ride-along sound, Web Audio).
- `brand/` — logo, small logo (also `public/favicon.svg`), frameless mark (also `public/mark.svg`, the top bar), PNGs; see `brand/README.md`.
- `worker/` — Cloudflare Worker: `index.js` routes `/api/*` and `/auth/*` (everything else is static assets from `dist/`), `auth.js` GitHub/Google OAuth with HMAC-signed cookies (plus a localhost-only dev login), `lab.js` the per-user Durable Object (SQLite) mirroring the notebook API, `fetch.js` the page fetcher for the agent. Config in `wrangler.jsonc`; CSP in `public/_headers`.
- `src/backend.js` — detects local vs cloud from `/api/health` (`mode: 'cloud'`). `src/agent/` — hosted agent: `loop.js` (provider-neutral tool loop, Node-testable), `anthropic.js` (official SDK) and `openai.js` (OpenAI-compatible: OpenAI, xAI, Gemini, OpenRouter) adapters, `tools.js`, `prompt.js`, `providers.js` (keys in browser storage only, OpenRouter PKCE). It emits the same event stream as `server/agent.js` so `src/ui/agent.js` renders both.
- `agent/system.md` — appended system prompt for the local research agent; its "How to answer" section is also used by the hosted prompt. The local tool allowlist is `ALLOWED_TOOLS` in `server/agent.js`.
- `notebook/` — user data (git-ignored): `entries/*.md`, `runs/*.json` (saved run = params + brief summary; the app re-simulates from params), `chats/*.md`. `notebook/.context/` holds the app state shared with the agent and chat thread JSON.

## Conventions
- Parameters are stored in SI units; `PARAMS[].scale` converts to display units (km, km/s). CLI `--set` and the agent's `sim-params` blocks take display units.
- Any new parameter goes in `sim/params.js` (schema + DEFAULTS) so it shows up in the UI, the CLI `describe` and the agent context automatically.
- Run `npm test` after changing physics or agent code. `test/fixtures/mock-claude.js` stands in for Claude Code: `CLAUDE_BIN=$PWD/test/fixtures/mock-claude.js npm run dev`. Hosted version locally: `npm run cf:dev` (needs `.dev.vars`, see DEPLOY.md).
- Keep the API identical between `server/index.js` and `worker/index.js`; the front end must not care which one it talks to.
- Dependencies: exact versions, at least two weeks old (`npm install --save-exact --before=<date>`), `npm audit` clean.
