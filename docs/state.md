# State — Benne 14

Live "where are we". Keep it skimmable; history goes in the Done log.

## Now

**v1 live on the Vercel preview, connected to Supabase** (`feat/v1-skeleton`). Full flow verified on the live link: kiosk order → kitchen (PIN) → TV board → phone bill, plus cash via the counter. Check setup any time at `/api/health`.

## Up next

1. Owner tries the preview on the real devices: kiosk tablet (portrait), kitchen tablet, TV.
2. Rotate the Supabase secret key (it was pasted in chat) and pick a new STAFF_PIN before real use.
3. Feedback round, then merge to `main` (production URL).
4. M4 owner admin (prices, sold-out) — moves the menu into the DB.

## v1 shortcuts (deliberate, see docs/BUILD_PLAN.md)

- Menu in code (`lib/menu.ts`); a price change is a one-line edit + deploy.
- Live updates by polling every 1.5 s (no Supabase Realtime yet).
- Payments mocked (`PAYMENTS=mock`); the UPI screen has a "Simulate payment" button.
- Card and cash both wait on the kitchen's "पैसे लेने हैं" shelf until staff confirm.
- Kitchen protected by one shared 4-digit `STAFF_PIN`.
- Language toggle switches dish names only.
- Order lines stored as a JSON snapshot on `orders` (no `order_items` table yet).

## Open questions (owner)

- GST inclusive or exclusive? (v1 adds 5% on top.)
- Tablet model / Android version; receipt printer; shop Wi-Fi reliability.
- Real dish photos (current ones are Wikimedia placeholders; filter coffee has none).

## Gotchas

- Free-tier Supabase pauses after inactivity; `/api/health` then shows a 521/522. Restore it in the dashboard.
- e2e tests blank the Supabase vars and refuse to run unless the store is `memory`, so they never write to the real DB.
- Locally, `PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e` uses a preinstalled Chromium.

## Done

- 2026-11-10 — v1 live on the preview with Supabase; fixed kitchen cards jumping after a tap, hydration warning, friendly kiosk errors; e2e locked to the memory store.
- 2026-10-25 — v1 slice: Next.js 15 app (kiosk, kitchen, board, phone bill), server-side pricing with GST, idempotent orders with daily tokens, staff PIN, 15 unit + 3 e2e tests, CI.
- 2026-10-25 — Light theme for all prototype screens; build plan + CLAUDE.md.
- 2026-10 — Design prototype (kiosk, kitchen, TV board) and Hindi-voiced walkthrough video.
