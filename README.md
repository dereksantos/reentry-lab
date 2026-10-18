<p align="center"><img src="brand/logo.svg" width="112" alt=""></p>

# Reentry Lab

A 3D atmospheric-entry simulator with a research agent built in. Fly a capsule, glider, probe or Mars lander through the atmosphere, and watch the heating, g-force and parachutes play out on a globe. You can ask the agent about what you're seeing: it runs the simulator itself, searches NASA reports and papers, and keeps a research notebook with you.

<img width="1928" height="841" alt="Screenshot 2026-10-18 at 4 16 44 PM" src="https://github.com/user-attachments/assets/de6be377-4337-4421-98c6-19cee97128dc" />

It runs two ways, from the same code:

- **On your machine** (`npm run dev`): the research agent is Claude Code running headless (`claude -p`) in this folder, using your own Claude Code login. The notebook is plain files in `notebook/`.
- **Hosted on Cloudflare** at **[reentrylab.ai](https://reentrylab.ai)** (to run your own, see [DEPLOY.md](DEPLOY.md)): visitors sign in with GitHub or Google, and the notebook is saved to their account.
  - **Bring your own key:** visitors use their own API key for Anthropic (Claude), OpenAI, xAI (Grok) or Google Gemini, or connect OpenRouter for many models.
  - **Agent in the browser:** the agent runs in the visitor's browser and calls the provider directly, so keys never reach the server.

Reentry Lab is open source under the [MIT license](LICENSE). If it's useful to you, you can [support it on Ko-fi](https://ko-fi.com/reentrylab).

## Quick start

Requirements: Node.js 20 or newer, and [Claude Code](https://code.claude.com/docs) installed and logged in (run `claude` once in a terminal).

```bash
npm ci --ignore-scripts
npm run dev
```

Open http://localhost:5317. `npm ci` installs exactly what `package-lock.json` lists and fails instead of silently resolving anything new; `--ignore-scripts` stops any package's install scripts from running. The dot in the Research tab turns green when Claude Code is found. If `claude` isn't on your PATH, start with `CLAUDE_BIN=/path/to/claude npm run dev`.

`npm start` builds an optimized bundle and serves it instead of the dev server. `npm test` runs the physics and agent tests.

To try the hosted version locally, run `npm run cf:dev`; [DEPLOY.md](DEPLOY.md) covers setup and deploying.

## Using it

The globe fills the window and the panels float over it as glass. Each panel has a small tab on its inner edge that tucks it away; `[` and `]` toggle the side panels, and `F` hides everything for a clear view of the planet.

- **Hangar** (top bar) is where you pick a mission: low-orbit capsule, Moon return, winged glider, fast sample return, inflatable decelerator, ballistic probe, a capsule with speculative magnetic braking, and a Mars lander. Each card shows the vehicle, its planet, entry speed and ballistic coefficient. The missions are inspired by real ones with rounded public numbers; they are not reconstructions of flown trajectories.
- **Settings** (left) change anything: vehicle, bank-angle guidance, entry state, parachutes, limits, planet and air density, integrator tolerance. Each group is a card with a one-line summary, so a closed card still tells you what's set. A dot marks values you changed from the preset.
- **The globe** shows the path colored by heat flux, the ground track, and key events, with the flight readout above it (*+7* shows the rest). Altitude is exaggerated (default ×8, the − and + buttons change it) because the atmosphere is otherwise too thin to see. *Follow* chases the vehicle, *Fit path* frames the whole flight.
- **Vehicle camera** shows the vehicle in its own flight frame: bank angle, plasma glow from the heating, wall glow from the radiative-equilibrium temperature, parachutes and horizon.
- **Ride along** (on the vehicle camera) puts you at a capsule window for the descent: the sky darkens and brightens with altitude, plasma builds with the heating, the cabin shakes with the loads, and the parachutes open on cue. Turn on sound and you'll hear it too, generated live from the run: roar from dynamic pressure, hiss from heating, rumble from g, and a thump as each parachute opens. Esc goes back.
- **Timeline and plots** are synced: press space or ▶ to play, drag the track or click any plot to jump. The last plot is the speed–altitude corridor with the heat-shield limit line.
- **Pin run** keeps the current flight on screen while you change settings, so you can compare up to three runs. **Save run** stores it in the notebook.
- **Research** (right) is the agent. With *Share the current run* on, every question includes what you have loaded and the moment you're looking at. When the agent suggests settings, an *Apply to simulator* button appears; applying pins your previous run for comparison. Runs the agent saves show up under **Runs**; notes and chat logs show up under **Notebook**.

## Install safety

- Every dependency is pinned to an exact version, including transitive ones (`overrides` in `package.json`), and every pinned version was at least two weeks old when chosen. `npm audit` reports 0 vulnerabilities.
- The lockfile resolves only to `registry.npmjs.org`, with an integrity hash for every package.
- To make `--ignore-scripts` the default for this folder, add `ignore-scripts=true` to a `.npmrc` file here; your own `npm run …` commands still run.
- **Install scripts:** with `--ignore-scripts`, no package's install scripts run. Three packages have them (esbuild, fsevents and workerd), and all three work without them.
- **Runtime dependencies (ten):** three, uPlot, marked, DOMPurify, topojson-client, world-atlas, three Fontsource font packages, and the Anthropic SDK. The SDK is loaded only by the hosted agent, in its own chunk.
- **Dev dependencies:** Vite, plus wrangler for the Cloudflare version.
- **Local server:** it listens on 127.0.0.1 only. The API refuses requests from other websites (Origin and Host checks, JSON only), so a page open in your browser can't start the agent.

## The research agent

Each question runs:

```
claude -p --output-format stream-json --verbose --include-partial-messages \
  --append-system-prompt-file agent/system.md --permission-mode dontAsk \
  --allowedTools "Read,Glob,Grep,WebSearch,WebFetch,Bash(node sim/cli.js *),Edit(./notebook/**),Write(./notebook/**)" \
  [--resume <session>] [--model <model>]
```

in this folder, with your question (plus the run context) on stdin. That means:

- It can read the project, search and read the web, run the simulator CLI, and write in `notebook/`. Anything else is refused automatically; it cannot change the simulator's code or run other commands.
- Conversations continue with `--resume`, so follow-ups have full context. *New* starts a fresh conversation; *History* reopens old ones.
- Because it runs as normal Claude Code (not `--bare`), your own Claude Code settings, hooks and MCP servers for this folder or your user also apply. Its instructions are in `agent/system.md`; edit them to change how it works with you.
- The cost shown under each answer is Claude Code's client-side estimate.

### Hosted mode

The hosted research agent (`src/agent/`) does the same job in the browser, with tools in place of Claude Code's:
- **Simulator:** `run_simulation`, `sweep`, `describe_parameters` and `list_presets`. They run the simulator in a Web Worker on the visitor's machine.
- **Source and app state:** `read_simulator_source` and `get_app_state`.
- **Notebook (signed in only):** `list_notes`, `read_note`, `write_note` and `list_saved_runs`.

Web research depends on the provider:
- **Claude:** Anthropic's built-in web search and web fetch.
- **OpenRouter:** optional web search, billed by OpenRouter.
- **The others:** a `fetch_url` tool that reads pages through the Worker.

Things to know:
- **Shared instructions:** the "How to answer" section of `agent/system.md` is shared by both modes.
- **Conversation history:** follow-ups resend earlier questions and answers as text; tool calls are not replayed.
- **Claude refusals:** for Claude Opus 5.5, Sonnet 5.5, Opus 5 and Fable 5.1, the agent turns on Anthropic's server-side refusal fallback (`fallbacks: "default"`). A request one model declines is retried on another, and the answer says which model replied.

## Simulator CLI

The same physics runs from the command line (this is what the agent uses):

```bash
node sim/cli.js list                                   # presets
node sim/cli.js describe                               # every parameter, unit and range
node sim/cli.js run --preset lunar-return --set entry.fpa=-6.2 --set guidance.bank=30
node sim/cli.js run --context                          # whatever is loaded in the app right now
node sim/cli.js sweep --preset lunar-return --vary entry.fpa=-5.5:-7.5:-0.5 --vary guidance.bank=0:90:45
node sim/cli.js run --preset sample-return --save "Steeper Stardust" --note "why"   # appears in the app
node sim/cli.js run --preset leo-capsule --csv out.csv  # full time history
```

Values use display units: km for altitude, km/s for speed, degrees for angles.

## The physics model

| Part | Model |
| --- | --- |
| Dynamics | 3-degree-of-freedom point mass in an inertial frame; rotating planet; atmosphere co-rotates, so aerodynamics use air-relative velocity |
| Integration | Dormand–Prince 5(4), adaptive step, event location by bisection for parachute deploys and touchdown |
| Gravity | Point mass plus J2 |
| Planet shape | WGS84 ellipsoid (Earth), oblate Mars; geodetic altitude |
| Earth atmosphere | U.S. Standard Atmosphere 1976 (layers computed to 86 km, tabulated to 1000 km) |
| Mars atmosphere | NASA Glenn educational model below 30 km, exponential above. Indicative only |
| Aerodynamics | Constant drag coefficient and lift-to-drag ratio; lift rotated by bank angle (constant, periodic reversals, or spinning ballistic) |
| Convective heating | Sutton–Graves stagnation point |
| Radiative heating | Tauber–Sutton correlation (Earth, above 9 km/s) |
| Wall temperature | Radiative equilibrium |
| Parachutes | Optional drogue then main, inflating over a fill time |
| Magnetic braking | Speculative toy model: extra drag proportional to aero drag above 3–5 km/s, with a fraction recovered as electricity |

The tests (`npm test`) check the atmosphere against the standard, geodetic conversions, energy conservation in a vacuum orbit with J2, the Allen–Eggers ballistic deceleration estimate, skip-out behavior and the presets.

**Not modeled:** attitude dynamics (6-DOF), Mach- and angle-dependent aerodynamics, real-gas and nonequilibrium chemistry, ablation and shape change, closed-loop guidance, wind, atmosphere variability, and the time a vehicle spends at each attitude. Treat absolute numbers as engineering estimates. Good next steps for a research-grade tool: aerodynamic tables vs. Mach, Apollo-style predictive guidance, Monte Carlo dispersions, NRLMSISE/Mars-GRAM atmospheres, and validation against flight data (Apollo 4, Stardust, Orion EFT-1, MSL) — a good project to do with the agent.

## Project layout

```
sim/          physics core (shared by the app, the CLI, the hosted agent and tests)
server/       local server: serves the app, bridges to claude -p, notebook API
worker/       Cloudflare Worker: sign-in, per-user notebook (Durable Object), page fetcher
src/          front end: three.js globe, vehicle camera and Hangar pictures, uPlot charts, panels, ride-along view
src/audio/    ride-along sound, synthesized with Web Audio
src/agent/    hosted research agent: tool loop, provider adapters, tools, prompt
agent/        instructions given to the research agent
notebook/     entries/ (notes), runs/ (saved runs), chats/ (conversation logs); git-ignored
test/         physics and agent tests, and a mock claude for testing the bridge
```

## Contributing and support

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to work on it, and [SECURITY.md](SECURITY.md) to report a vulnerability. If you'd like to help keep it going, the project is on [Ko-fi](https://ko-fi.com/reentrylab).

## License

[MIT](LICENSE) © 2026 Derek Santos
