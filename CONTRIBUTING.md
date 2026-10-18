# Contributing

Thanks for helping. Reentry Lab is a small project, and contributions are welcome:
- physics improvements
- validation against flight data
- new presets
- UI fixes
- support for more model providers

## Setup

```bash
npm ci --ignore-scripts
npm run dev        # local version: http://localhost:5317 (needs Claude Code for the agent)
npm run cf:dev     # hosted version: http://localhost:8787 (see DEPLOY.md for .dev.vars)
npm test
```

To work on the local agent without spending tokens, use the mock Claude: `CLAUDE_BIN=$PWD/test/fixtures/mock-claude.js npm run dev`.

## Conventions

- **Units:** parameters are stored in SI units. `PARAMS[].scale` in `sim/params.js` converts them to display units (km, km/s). The CLI, the agents and `sim-params` blocks all take display units.
- **New parameters:** add them to `sim/params.js` (the schema and `DEFAULTS`). The UI, the CLI's `describe` and both agents then pick them up automatically.
- **Simulator commands:** run, sweep, describe and list live in `sim/commands.js`, which both the CLI and the hosted agent use. Change behaviour there, not in one caller.
- **Agent instructions:** the "How to answer" section of `agent/system.md` is shared by both agents.
- **Tests:** run `npm test` after changing physics or agent code.
- **Dependencies:** add as few as possible, pin exact versions, and pick versions at least two weeks old (`npm install --save-exact --before=<date>`). Keep `npm audit` clean.

## Pull requests

Keep them focused, describe what you checked, and include a test when you change physics or the agent loop. For a physics change, say what reference it was checked against.
