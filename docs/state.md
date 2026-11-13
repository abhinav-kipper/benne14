# State — Benne 14

Live "where are we". Keep it skimmable; history goes in the Done log.

## Now

**Live on `main`** (production: https://benne14-git-main-abhinav-mudgal-s-projects.vercel.app, check
`/api/health`). Kiosk, kitchen, TV board, phone bill and owner dashboard all work end to end on
Supabase. Not launched to customers yet: test mode is on, and the launch blockers in `docs/audit.md`
section A are open.

## Up next

0. **UI and customer-flow audit: `docs/ui-audit.md`** (2026-11-13). Owner wants the UI raised first; the launch blockers below are on hold until then, not dropped.

1. **Launch blockers: `docs/audit.md` section A** (not yet discussed with the owner): device key + rate
   limit for placing orders, PIN on the order list, separate owner PIN, reword the "money comes back"
   line, hide "Paid" until the customer taps, move the server region next to Supabase (need the
   Supabase region), check hosting plans, `TEST_MODE=0`.
2. **Owner to do**: run `supabase/migrations/0004_menu_edit_and_migration_log.sql`; rotate the Supabase
   secret key and choose a new `STAFF_PIN` (both were shared in chat); delete merged branches on GitHub;
   ₹1 UPI test from GPay, PhonePe and Paytm; try everything on the real tablet, TV and phone.
3. **Add / remove dishes from the dashboard** (owner asked; questions pending: photo upload, new extras,
   new sections, ordering). Moves the dish list into the database.
4. **Automatic payment confirmation**: `docs/payments.md` (Paytm card-machine cloud integration is the
   likeliest route; waiting on Paytm credentials).
5. Discount codes (a code field in the cart, server-validated, a line on the bill).
6. Real dish photos; real opening hours in `lib/shop.ts` (charts assume 8–23).

## How things are (decisions worth knowing)

- English only. Full menu prices, no discount. Order numbers are plain daily numbers (old "A-042" rows show as "42").
- GST 5% on top, rounded to the nearest rupee and split CGST/SGST: bills have no round-off line.
- Start screen has one "Tap to order"; dine in / takeaway is asked in the cart; the order-number screen asks "Still there?" after 100 s and returns to start 20 s later; an untouched order is cleared after 60 s + a 15 s prompt (no Start over button).
- UPI goes straight to the shop's Paytm UPI ID; the customer taps "I've paid" and staff confirm on the soundbox. Card and cash wait on the kitchen's "Collect payment" shelf.
- Test mode (on unless `TEST_MODE=0`): cash counts as paid, a ₹1 test item shows.
- Owner dashboard is behind the kitchen's staff PIN for now (no separate login).
- Menu = dishes in `lib/menu.ts` + the owner's overrides in the database. Sold out lasts for the day.
- Screens poll (no Realtime), pause when hidden, and reload themselves after a deploy.
- Design rule: never flatten an approved design; compare against `main` side by side before pushing visual changes (see `CLAUDE.md`).

## Open questions (owner)

- GST inclusive or exclusive? (v1 adds 5% on top.)
- Tablet model / Android version; receipt printer; shop Wi-Fi reliability.
- Real dish photos (current ones are Wikimedia placeholders; filter coffee has none).

## Gotchas

- The Claude environment has the live Supabase keys: anything run locally can hit the real DB. For local runs blank them (`NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SECRET_KEY=`); e2e already does and refuses otherwise.
- Don't stop servers with `pkill -f next…` / a loop whose pattern appears in the same command line: it kills the shell. Put the loop in a script file and run the file.
- Every branch gets a preview at `https://benne14-git-<branch-with-dashes>-abhinav-mudgal-s-projects.vercel.app`; previews share the production database.
- This session can't delete GitHub branches or run downloaded binaries; database integration tests run only in CI (the `db` job).

- Free-tier Supabase pauses after inactivity; `/api/health` then shows a 521/522. Restore it in the dashboard.
- e2e tests blank the Supabase vars and refuse to run unless the store is `memory`, so they never write to the real DB.
- Locally, `PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e` uses a preinstalled Chromium.

## Done

- 2026-11-13 — Code upkeep (audit D): kiosk and dashboard split per screen, menu state via context, ESLint + Prettier in CI, Supabase store tested on a real Postgres in CI, migration log, docs rewritten, Dependabot.

- 2026-11-13 — Audit (`docs/audit.md`) and fixes for reliability and ease of use: TV shows every ready order as scaled tickets, busy kitchen rail, auto-reload, orders past midnight, lighter polling, atomic menu edits, uptime check, wording, readable text, app icons.

- 2026-11-13 — Owner dashboard v1 (`/admin`): today vs yesterday, needs-you payments, orders with paid/cancel/refund, menu sold-out (back on next morning) + price/name/description/extras, reports (day/week/month/custom, dishes, busy hours, GST) + CSV, change history. Menu changes stored as overrides on the menu in code.

- 2026-11-13 — Hardening: 111 unit/DB tests (incl. real migrations in PGlite), 32 browser tests incl. API abuse and network failures, read-only smoke checks after each Vercel deploy. Fixed 500s on bad input, PIN guessing, stale-tablet undo, endless bill loading. See `docs/testing.md`.

- 2026-11-12 — Second owner round: no discount (full prices), podi spice removed, options/notes renamed, clearer ₹, thank-you line matches the order, dine in/takeaway moved to the cart, 2-minute return to start, kitchen shelf shrinks to fit.

- 2026-11-12 — Owner feedback round: English only, no 14% sticker on the start screen, ₹ drawn by the brand fonts, green +/red − tags on kitchen chits, today's history on kitchen and board, plain order numbers, no round-off on bills, start screen returns 15 s after the order number.

- 2026-11-12 — Test mode (default on): cash counts as paid, ₹1 payment test item, kiosk ribbon.
- 2026-11-12 — Real UPI to the shop's Paytm ("I've paid" + counter confirm on the payment shelf); kitchen PIN checked when typed.
- 2026-11-10 — v1 live on the preview with Supabase; fixed kitchen cards jumping after a tap, hydration warning, friendly kiosk errors; e2e locked to the memory store.
- 2026-10-25 — v1 slice: Next.js 15 app (kiosk, kitchen, board, phone bill), server-side pricing with GST, idempotent orders with daily tokens, staff PIN, 15 unit + 3 e2e tests, CI.
- 2026-10-25 — Light theme for all prototype screens; build plan + CLAUDE.md.
- 2026-10 — Design prototype (kiosk, kitchen, TV board) and Hindi-voiced walkthrough video.
