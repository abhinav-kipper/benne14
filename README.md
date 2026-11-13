# Benne 14

Self-order kiosk, kitchen display, TV order board, phone bill and owner dashboard for
**Benne 14 — Authentic Bangalore Dosa** (Indirapuram). One Next.js app, deployed on Vercel, data in Supabase.

| Screen | Route | Device |
|---|---|---|
| Kiosk | `/kiosk` | Android tablet, portrait (designed at 800×1280) |
| Kitchen | `/kitchen` | Tablet, landscape (1280×800), staff PIN |
| Order board | `/board` | TV, 1920×1080 |
| Phone bill + live status | `/r/<order id>` | Customer's phone (QR on the kiosk) |
| Owner dashboard | `/admin` | Owner's phone, staff PIN |

Production: <https://benne14-git-main-abhinav-mudgal-s-projects.vercel.app> · setup check: `/api/health`.

## Where to read

- `docs/state.md` — where things stand, what's next, gotchas (read first)
- `docs/ARCHITECTURE.md` — how the app works
- `docs/audit.md` — open issues and what's been fixed (launch blockers are section A)
- `docs/testing.md` — the test layers and what each proves
- `docs/payments.md` — how payments work today and the route to automatic confirmation
- `CLAUDE.md` — working rules for Claude Code sessions

## Run it

```bash
npm install
npm run dev          # http://localhost:3000 — PIN 1414 locally
npm run check        # typecheck + lint + format check + unit/database tests
npm run e2e          # browser tests on a production build (in-memory store, never the real database)
npm run format       # fix formatting
```

Without Supabase env vars the app uses an in-memory store (fine locally, refused on Vercel). Env vars: `.env.example`.

Database changes are SQL files in `supabase/migrations/`, pasted into the Supabase SQL editor in order.
`/api/health` lists any that still need running.

## Design history

`prototype/` holds the original static HTML screens and the walkthrough video from before the app was
built (dark theme, Hindi text, old "A-001" numbers). The app has moved on from it; the running app is
the design reference now. Food photos are placeholders from Wikimedia Commons (credits in
`public/food/CREDITS.tsv`) until the restaurant's own photos are shot.
