# Benne 14

Self-order kiosk, kitchen display, order board and owner admin for **Benne 14 — Authentic Bangalore Dosa** (Indirapuram).

## Status

Design prototype. Static HTML screens in `prototype/`, no backend yet. Payments will be mocked.

## Prototype

- `prototype/theme.css` — design tokens ("Tawa" direction: cast-iron dark, benne-butter accent; Big Shoulders Display + Familjen Grotesk + Tiro Devanagari Hindi)
- `prototype/menu.js` — menu data (real launch prices, Hindi names + descriptions)
- `prototype/kiosk-*.html` — kiosk screens, 800×1280 portrait
- `prototype/shots/` — rendered screenshots
- `prototype/_explore/` — rejected directions, kept for reference

Render a screenshot: `node prototype/shot.js prototype/kiosk-menu.html out.png`

Food photos are placeholders from Wikimedia Commons (CC BY / CC BY-SA, see `prototype/assets/food/CREDITS.tsv`) until the restaurant's own photos are shot.
