# Benne 14

Self-order kiosk, kitchen display, TV order board, phone bill and owner dashboard for
**Benne 14 — Authentic Bangalore Dosa** (Indirapuram). One Next.js app, deployed on Vercel, data in Supabase.

| Screen | Route | Device |
|---|---|---|
| Kiosk | `/kiosk` | Android tablet, portrait (designed at 800×1280) |
| Kitchen | `/kitchen` | Tablet, landscape (1280×800), staff PIN (4 digits) |
| Order board | `/board` | TV, 1920×1080 |
| Phone bill + live status | `/r/<order id>` | Customer's phone (QR on the kiosk) |
| Owner app | `/admin` | Owner's phone, owner PIN (6 digits) |

Production: <https://benne14-git-main-abhinav-mudgal-s-projects.vercel.app> · setup check: `/api/health`.

## Where to read

- `docs/state.md` — where things stand, what's next, gotchas (read first)
- `docs/go-live.md` — what is left before the first real customer
- `docs/README.md` — the list of every other doc and what it is for
- `CLAUDE.md` — working rules for Claude Code sessions

## Run it

```bash
npm install
npm run dev          # http://localhost:3000 — PIN 1414 locally (kitchen and owner app)
npm run check        # typecheck + lint + format check + unit/database tests
npm run e2e          # browser tests on a production build (in-memory store, never the real database)
npm run format       # fix formatting
scripts/serve-local.sh   # build and serve like the tests do (port 3200, in-memory store)
scripts/stop-server.sh   # stop any local server
```

Without Supabase env vars the app uses an in-memory store (fine locally, refused on Vercel). Env vars: `.env.example`.

Database changes are SQL files in `supabase/migrations/`, pasted into the Supabase SQL editor in order.
`/api/health` lists any that still need running.

The kiosk tablet is set up once with the staff PIN; after that only that tablet can place orders.

## Photos and design history

`prototype/` holds the HTML screens and walkthrough video made before the build; the running app is the design reference now.

Dish photos in `public/food` are free stock photos from Pexels and Unsplash, cropped to 1400×1400 (sources and licences: `public/food/CREDITS.tsv`), until the restaurant's own photos are shot.
