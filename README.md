# Benne 14

Self-order kiosk, kitchen display, order board and owner admin for **Benne 14 — Authentic Bangalore Dosa** (Indirapuram).

## Status

v1 app (Next.js 15 + Supabase + Vercel) — see `docs/state.md`. Design prototype in `prototype/`.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000 — /kiosk, /kitchen (PIN 1414 locally), /board
npm test             # unit tests (pricing, tokens, status rules)
npm run e2e          # kiosk → kitchen → board → phone bill, on a production build
```

Without Supabase env vars the app uses an in-memory store (fine locally, not on Vercel). Env vars: `.env.example`.
Database: run `supabase/migrations/0001_orders.sql` once in the Supabase SQL editor.

## Prototype

- `prototype/theme.css` — design tokens, dark and light (`?theme=light` on any screen; `light.css` covers fixed-colour spots)
- `prototype/shots/light/` — light-theme renders (`THEME=light node prototype/shots-all.js`)
- previously: `prototype/theme.css` — design tokens ("Tawa" direction: cast-iron dark, benne-butter accent; Big Shoulders Display + Familjen Grotesk + Tiro Devanagari Hindi)
- `prototype/menu.js` — menu data (real launch prices, Hindi names + descriptions)
- `prototype/kiosk-*.html` — kiosk screens, 800×1280 portrait: home → menu → item → cart → pay → pay-upi → done
- `prototype/kitchen.html` — kitchen display, 1280×800 landscape (`node prototype/shot.js prototype/kitchen.html out.png 1280 800`)
- `prototype/board.html` — TV order board, 1920×1080
- `prototype/shots/` — rendered screenshots
- `prototype/_explore/` — rejected directions, kept for reference

Render a screenshot (needs Playwright): `node prototype/shot.js prototype/kiosk-menu.html out.png`

Food photos are placeholders from Wikimedia Commons (CC BY / CC BY-SA, see `prototype/assets/food/CREDITS.tsv`) until the restaurant's own photos are shot.

## Walkthrough video

`prototype/video/benne14-walkthrough.mp4` — ~100 s, 1080p, Hindi voiceover with sound effects and a soft music bed: home → menu → customise → cart → pay → token → kitchen → TV board.

- `prototype/video/stage.html` frames each screen, shows the taps and captions; screens expose small `window.demo` hooks for state changes.
- `prototype/video/vo/script.json` is the Hindi voiceover script (one line per scene). `ELEVENLABS_API_KEY=… node prototype/video/vo/generate.js` regenerates the clips (`ELEVENLABS_VOICE_ID` to pin a voice; current: Nitya, see `durations.json`).
- `prototype/video/vo/sfx/` holds the sound effects and music bed (ElevenLabs sound generation, prompts in `vo/sfx.json`).
- `node prototype/video/record.js` re-records the video; each scene waits for its voice line, then voice, effects and the ducked music are mixed in with ffmpeg.
