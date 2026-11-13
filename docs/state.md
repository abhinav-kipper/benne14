# State — Benne 14

Live "where are we". Keep it skimmable; history goes in the Done log.

## Now

**v1 live on the Vercel preview, connected to Supabase** (`feat/v1-skeleton`). Full flow verified on the live link: kiosk order → kitchen (PIN) → TV board → phone bill, plus cash via the counter. Check setup any time at `/api/health`.

## Up next

- **Payments: read `docs/payments.md`** (live setup, test mode, Paytm card-machine cloud integration = next, Paytm gateway blocked by their maintenance, Razorpay parked).

- **Before launch: set `TEST_MODE=0` in Vercel** (test mode: cash counts as paid, ₹1 test item, red ribbon on the kiosk).

0. Test real UPI with a ₹44 masala tea from GPay, PhonePe and Paytm; check the soundbox announces and the payee shows correctly.

1. Owner tries the preview on the real devices: kiosk tablet (portrait), kitchen tablet, TV.
2. Rotate the Supabase secret key (it was pasted in chat) and pick a new STAFF_PIN before real use.
3. Feedback round, then merge to `main` (production URL).
4. M4 owner admin (prices, sold-out) — moves the menu into the DB.
5. Discount codes (owner asked for "discount applied" codes later): a code field in the cart, server-validated, shown as a line on the bill. The `savings` column is already there.

## v1 shortcuts (deliberate, see docs/BUILD_PLAN.md)

- Menu in code (`lib/menu.ts`); a price change is a one-line edit + deploy.
- Live updates by polling every 1.5 s (no Supabase Realtime yet).
- UPI goes straight to the shop's Paytm UPI ID (`lib/shop.ts`); the customer taps "I've paid" and staff confirm on the soundbox ("Paid"). No automatic confirmation until the Paytm API (needs API access + merchant key). `PAYMENTS=mock` for tests/demos.
- Card and cash both wait on the kitchen's "Collect payment" shelf until staff confirm.
- Kitchen protected by one shared 4-digit `STAFF_PIN`.
- English only everywhere (owner's call, 2026-11-12). The `prototype/` HTML and the video still have the old Hindi.
- Order numbers are plain daily numbers (1, 2, 3…). Old "A-042" rows are shown as "42" by the app; `supabase/migrations/0002_plain_tokens.sql` makes new rows store plain numbers (optional to run).
- No discount: full menu prices (launch 14% off removed 2026-11-12). Dosas have no podi-spice choice; kitchen notes are Less oil, Extra crisp, and Potato stuffing on the side (masala dosa only).
- Start screen has one "Tap to order" button; dine in / takeaway is asked in the cart. The order-number screen returns to start after 2 minutes.
- Kitchen "Ready at counter" shelf shrinks its cards (3 steps) when they don't fit, so old ready orders stay visible.
- ₹ comes from a one-glyph font (`public/fonts/rupee.woff2`, cut from Roboto Condensed) first in the display stack: Big Shoulders' ₹ looked like a 7.
- GST (5%, on top) is rounded to the nearest rupee and split into CGST/SGST, so bills have no round-off line.
- History: kitchen "Today's orders" panel (with "Back to counter" for collected orders) and a "Collected" row on the TV board, from `GET /api/orders?view=today`.
- Order lines stored as a JSON snapshot on `orders` (no `order_items` table yet).

## Open questions (owner)

- GST inclusive or exclusive? (v1 adds 5% on top.)
- Tablet model / Android version; receipt printer; shop Wi-Fi reliability.
- Real dish photos (current ones are Wikimedia placeholders; filter coffee has none).

## Gotchas

- The Claude environment has the live Supabase keys: anything run locally can hit the real DB. For local runs blank them (`NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SECRET_KEY=`); e2e already does and refuses otherwise.
- Don't stop servers with `pkill -f next…` / a loop whose pattern appears in the same command line: it kills the shell. Put the loop in a script file and run the file.
- Live preview (stable branch link): https://benne14-git-feat-v1-skeleton-abhinav-mudgal-s-projects.vercel.app — check `/api/health`.

- Free-tier Supabase pauses after inactivity; `/api/health` then shows a 521/522. Restore it in the dashboard.
- e2e tests blank the Supabase vars and refuse to run unless the store is `memory`, so they never write to the real DB.
- Locally, `PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e` uses a preinstalled Chromium.

## Done

- 2026-11-13 — Hardening: 111 unit/DB tests (incl. real migrations in PGlite), 32 browser tests incl. API abuse and network failures, read-only smoke checks after each Vercel deploy. Fixed 500s on bad input, PIN guessing, stale-tablet undo, endless bill loading. See `docs/testing.md`.

- 2026-11-12 — Second owner round: no discount (full prices), podi spice removed, options/notes renamed, clearer ₹, thank-you line matches the order, dine in/takeaway moved to the cart, 2-minute return to start, kitchen shelf shrinks to fit.

- 2026-11-12 — Owner feedback round: English only, no 14% sticker on the start screen, ₹ drawn by the brand fonts, green +/red − tags on kitchen chits, today's history on kitchen and board, plain order numbers, no round-off on bills, start screen returns 15 s after the order number.

- 2026-11-12 — Test mode (default on): cash counts as paid, ₹1 payment test item, kiosk ribbon.
- 2026-11-12 — Real UPI to the shop's Paytm ("I've paid" + counter confirm on the payment shelf); kitchen PIN checked when typed.
- 2026-11-10 — v1 live on the preview with Supabase; fixed kitchen cards jumping after a tap, hydration warning, friendly kiosk errors; e2e locked to the memory store.
- 2026-10-25 — v1 slice: Next.js 15 app (kiosk, kitchen, board, phone bill), server-side pricing with GST, idempotent orders with daily tokens, staff PIN, 15 unit + 3 e2e tests, CI.
- 2026-10-25 — Light theme for all prototype screens; build plan + CLAUDE.md.
- 2026-10 — Design prototype (kiosk, kitchen, TV board) and Hindi-voiced walkthrough video.
