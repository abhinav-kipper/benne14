# Benne 14

Self-order kiosk, kitchen display, order board and owner admin for **Benne 14 — Authentic Bangalore Dosa** (Indirapuram).

## Status

Design prototype. Static HTML screens in `prototype/`, no backend yet. Payments will be mocked.

## Prototype

- `prototype/theme.css` — design tokens ("Tawa" direction: cast-iron dark, benne-butter accent; Big Shoulders Display + Familjen Grotesk + Tiro Devanagari Hindi)
- `prototype/menu.js` — menu data (real launch prices, Hindi names + descriptions)
- `prototype/kiosk-*.html` — kiosk screens, 800×1280 portrait: home → menu → item → cart → pay → pay-upi → done
- `prototype/kitchen.html` — kitchen display, 1280×800 landscape (`node prototype/shot.js prototype/kitchen.html out.png 1280 800`)
- `prototype/board.html` — TV order board, 1920×1080
- `prototype/shots/` — rendered screenshots
- `prototype/_explore/` — rejected directions, kept for reference

Render a screenshot (needs Playwright): `node prototype/shot.js prototype/kiosk-menu.html out.png`

Food photos are placeholders from Wikimedia Commons (CC BY / CC BY-SA, see `prototype/assets/food/CREDITS.tsv`) until the restaurant's own photos are shot.

## Walkthrough video

`prototype/video/benne14-walkthrough.mp4` — ~75 s, 1080p: home → menu → customise → cart → pay → token → kitchen → TV board.

Re-record after design changes: `node prototype/video/record.js` (Playwright + ffmpeg). The script drives `prototype/video/stage.html`, which frames each screen and shows the taps; screens expose small `window.demo` hooks for the state changes.
