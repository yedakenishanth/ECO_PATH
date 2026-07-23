# EcoPath — Carbon-Conscious Commuting

EcoPath is a single-page web app that gamifies eco-friendly commuting. Users log trips, earn EcoCredits, unlock badges, climb a leaderboard, and redeem coupons — all designed to encourage lower-carbon transportation choices.

## Features

- **Landing page** with hero section and feature highlights
- **Auth flow** (sign up / sign in) UI
- **Dashboard** with trip tracking and stats
- **Community & rewards** — EcoCredits, coupons, and a live activity feed
- **Achievements** — badges and a global leaderboard with levels/progress
- **Map integration** via Leaflet.js

## Tech Stack

- Vanilla HTML, CSS, and JavaScript (no build step required)
- [Leaflet.js](https://leafletjs.com/) for maps
- Google Fonts (Sora, IBM Plex Mono)

## Getting Started

This is a static single-file app — no build tools or dependencies to install.

1. Clone the repo:
   ```bash
   git clone https://github.com/yedakenishanth/ecopath.git
   cd ecopath
   ```
2. Open `index.html` directly in your browser, or serve it locally:
   ```bash
   python3 -m http.server 8000
   ```
   Then visit `http://localhost:8000`.

## Project Structure

```
.
├── index.html      # Full application (markup, styles, and logic)
├── README.md
└── LICENSE
```

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.
