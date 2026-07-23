# Contributing to EcoPath

Thanks for considering a contribution! This is a small, framework-free static app, so the bar to get set up is low.

## Getting set up

```bash
git clone https://github.com/yedakenishanth/ECO_PATH.git
cd ECO_PATH
npm test              # run the logic test suite
npm start             # serve locally at http://localhost:8000
```

No build step, no `npm install` required for the app itself — dependencies (Leaflet, Google Fonts) are loaded via CDN `<script>`/`<link>` tags in `index.html`.

## Project layout

- `index.html` — markup/structure only
- `styles.css` — all styling
- `app.js` — application state, rendering, and logic
- `test.js` — dependency-free Node test suite for the pure logic (levels, points, CO2 math)
- `.github/workflows/ci.yml` — runs `test.js` on every push/PR

## Before opening a PR

- Run `npm test` and make sure all tests pass.
- If you touch `getLevel`, `levelPct`, `logTrip`, or other pure logic, add or update a test in `test.js` covering the change.
- If you add a new place that renders user-entered text (trip names, chat messages, form inputs) via `innerHTML`, run it through the existing `escapeHtml()` helper — this codebase has had real XSS bugs from skipping this, so treat it as required, not optional.
- Keep the "no build step" philosophy unless a change genuinely needs one — open an issue first to discuss before introducing a bundler/framework.

## Reporting bugs / suggesting features

Open a GitHub issue. For anything nontrivial (e.g. adding a backend, swapping the persistence layer), please open an issue to discuss the approach before submitting a large PR — there are some architectural decisions (see the Roadmap in `README.md`) that are still open.

## Known limitations to keep in mind

See the **Known Limitations** section in `README.md` — auth is a UI-only demo, the leaderboard/community feed are static sample data, and Nominatim/OSRM are used unauthenticated. Contributions that touch these areas should read that section first.
