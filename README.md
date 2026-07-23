# EcoPath — Carbon-Conscious Commuting

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Leaflet](https://img.shields.io/badge/Leaflet.js-199900?logo=leaflet&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)

EcoPath is a single-page web app that gamifies eco-friendly commuting. Users log trips, earn EcoCredits, unlock badges, climb a leaderboard, and redeem coupons — all designed to encourage lower-carbon transportation choices.

**[Live demo →](https://yedakenishanth.github.io/ECO_PATH/)**

## Features

| Area | What it does |
|---|---|
| **Route Planner** | Geocodes real addresses (Nominatim) and calculates real driving routes (OSRM), plotted live on a Leaflet map |
| **Carbon comparison** | Compares CO2 output across 8 transport modes (walk, bike, e-bike, bus, train, carpool, EV, car) for the planned route |
| **Live GPS Tracker** | Tracks an active trip in real time using device geolocation, with a simulated fallback when GPS is unavailable |
| **EcoCredits & Levels** | Points-based reward system with 7 levels and progress bars |
| **Badges** | 12 achievements unlocked by trip count, CO2 saved, streaks, and more |
| **Coupons** | Auto-unlocked reward coupons every 300 EcoCredits |
| **Community** | Leaderboard and a live activity feed |
| **Eco Coach** | Chat-style assistant UI with a local fallback when no AI backend is configured |
| **Persistence** | Progress (points, trips, badges, streak) is saved to `localStorage` and restored on reload |

## Tech Stack

- Vanilla HTML, CSS, and JavaScript — no build step, no framework
- [Leaflet.js](https://leafletjs.com/) for the interactive map
- [Nominatim](https://nominatim.org/) for geocoding addresses
- [OSRM](http://project-osrm.org/) for route calculation
- Google Fonts (Sora, IBM Plex Mono)

> **Note on "AI" features:** the landing page markets an "AI carbon engine." In this version the carbon math is a deterministic calculation (distance x emission factor per transport mode), not a machine-learning model — it's precise, but not "AI" in the predictive sense. The Eco Coach chat panel is wired to call the Anthropic API directly from the browser; without a backend proxy and API key this will fail and fall back to canned responses. See [Roadmap](#roadmap) below.

## Getting Started

This is a static app — no build tools or dependencies to install.

1. Clone the repo:
   ```bash
   git clone https://github.com/yedakenishanth/ECO_PATH.git
   cd ECO_PATH
   ```
2. Open `index.html` directly in your browser, or serve it locally:
   ```bash
   python3 -m http.server 8000
   ```
   Then visit `http://localhost:8000`.

## Project Structure

```
.
├── index.html      # Page markup / structure only
├── styles.css      # All styling
├── app.js          # Application state, rendering, and logic
├── README.md
└── LICENSE
```

## Changelog

- **Fix:** sign-up/sign-in now validate email format and require a name and an 8+ character password before letting you in, instead of accepting any input silently. Still not real authentication — see Known Limitations.
- **Fix:** `getLevel` had an off-by-one against `levelPct`, so users sitting on 500–999 (etc.) EcoCredits saw a progress bar stuck at 100% while still labeled the lower level. Both now agree on the same threshold bands.
- **Fix:** form labels weren't linked to their inputs (`for`/`id`); route planner inputs relied on placeholder text only. Both fixed for screen readers.
- **Fix:** the Eco Coach and landing page implied a live, always-on AI connection ("Powered by Claude AI · Always online", "AI-POWERED", "AI CARBON ENGINE"). Copy now reflects that the AI calls fall back to built-in logic without a backend proxy — matches what's already disclosed in this README.

## Known Limitations

- **No backend/auth** — "Sign up" and "Sign in" validate input shape (email format, password length) client-side but there's no real authentication, password hashing, or per-user accounts — anyone can type any email and get in.
- **Local-only leaderboard/feed** — the leaderboard and community feed are hardcoded sample data, not live from other users.
- **Public API rate limits** — Nominatim and OSRM's public demo servers are used directly from the client with no API key. They're rate-limited and not meant for production traffic; expect throttling under heavy use.
- **Single-user persistence** — progress is saved to the browser's `localStorage`, so it's local to one device/browser, not synced across devices.

## Testing

Pure logic (level thresholds, points math, CO2 math) is covered by a small dependency-free Node test suite:

```bash
node test.js
```

Runs automatically on every push/PR via GitHub Actions (see `.github/workflows/ci.yml`).

## Roadmap

- [ ] Swap `localStorage` persistence for a real backend (e.g. Supabase/Firebase) with authentication and a genuine multi-user leaderboard
- [ ] Move the Anthropic API calls behind a small server-side proxy so the Eco Coach and AI route analysis actually work (an API key can't safely live in client-side code)
- [x] Automated tests for the pure logic (`getLevel`, `levelPct`, `logTrip`) — see `test.js`
- [x] GitHub Actions workflow for tests on push/PR
- [ ] Auto-deploy to GitHub Pages via Actions
- [x] Partial accessibility pass — labels now linked to inputs via `for`/`id`
- [ ] Further accessibility: ARIA live regions for the toast/live-trip panel, full keyboard nav audit

## Contributing

Issues and PRs are welcome. For larger changes, please open an issue first to discuss what you'd like to change.

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.
