# State — Benne 14

Live "where are we". Keep it skimmable; history goes in the Done log.

## Now

**v1 (thin end-to-end slice) on `feat/v1-skeleton`.** Kiosk → kitchen → TV board → phone bill works on the in-memory store; Supabase store + migration written, not yet connected.

## Up next

1. Connect Supabase: run `supabase/migrations/0001_orders.sql` in the SQL editor; add `SUPABASE_SECRET_KEY` and `STAFF_PIN` to Vercel (and the Claude environment).
2. Vercel preview on the real devices: kiosk tablet (portrait), kitchen tablet, TV.
3. Owner feedback round on the live preview, then merge to `main`.
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

## Done

- 2026-10-25 — v1 slice: Next.js 15 app (kiosk, kitchen, board, phone bill), server-side pricing with GST, idempotent orders with daily tokens, staff PIN, 15 unit + 3 e2e tests, CI.
- 2026-10-25 — Light theme for all prototype screens; build plan + CLAUDE.md.
- 2026-10 — Design prototype (kiosk, kitchen, TV board) and Hindi-voiced walkthrough video.
