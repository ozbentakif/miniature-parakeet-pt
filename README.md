# miniature-parakeet-pt

A small proof-of-concept prototype built for a product task.

**Live app:** _link added after deployment_

## What to look at
_To be written: 3 short steps a reviewer should follow._

## What it does
_To be written._

## Assumptions and limits
- Proof of concept only: no real platform APIs, no live AI, and any action is simulated.
- Data files are loaded in the browser and are never uploaded or stored.
- _Task-specific assumptions to be added._

## Run locally
Requires Node.js 24.

```bash
npm install
npm run dev      # start the app
npm test         # run the unit tests
npm run build    # production build in dist/
```

Data profiling (Python 3, standard library only):

```bash
py scripts/profile_csv.py path/to/file.csv
```

## Project structure
```
src/core/     data logic in plain TypeScript (no UI code), with Vitest tests
src/          React UI
scripts/      Python helper scripts
.github/      CI: lint, test and build on every push; deploy to GitHub Pages
```

## How it was built
_To be written: tools used, including AI tools._
