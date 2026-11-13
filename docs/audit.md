# Audit and fix checklist

Audit date: 2026-11-13 (commit `fc8e15f` on `main`). Method: read all code, read-only probes of the
live site, local run with awkward data (long names, 18-item order, 12 orders at once, wrong screen sizes).
**Keep this file current:** tick items when merged, add the PR, note decisions ("won't fix: why").

Legend: `[ ]` pending · `[x]` done · `[-]` decided not to do (with reason)

## A. Before real customers (security, trust, speed, hosting)

- [ ] A1 Anyone on the internet can place orders: `POST /api/orders` has no device check or rate limit; in test mode cash goes straight to the kitchen. Fix: kiosk device key + rate limit.
- [ ] A2 Today's orders are public: `GET /api/orders` and `?view=today` return names, items, totals and order ids without a PIN (live: 15 orders, 11 with names). With an id anyone can call `/claim` to cancel an unpaid UPI order or mark it "says paid". Fix: PIN on the full list; slim public feed (number, name, status) for the TV board.
- [ ] A3 One 4-digit PIN guards kitchen and owner dashboard (takings, prices). The current PIN and the Supabase secret key were shared in chat. Fix: rotate both; separate owner PIN or login (`lib/admin.ts` `adminDenied`).
- [ ] A4 Pay screen says "Payment stuck? Don't worry, the money comes back to you automatically." False for direct UPI. Reword.
- [ ] A5 UPI is on trust: kitchen shows "Paid" even on orders whose QR is still open. Fix: hide "Paid" until the customer tapped "I've paid" (until Paytm auto-confirmation, see `docs/payments.md`).
- [ ] A6 Slow for India: functions run in `iad1` (Washington DC); each DB call 0.25–0.75 s; a poll ~0.85 s; placing an order needs 3–4 DB calls. Fix: `vercel.json` function region next to the Supabase region (ask the user for the region).
- [ ] A7 Hosting limits: polling is ~2 M requests/month. User to check the Vercel plan (free plan: commercial use, request limits) and Supabase plan (free: pauses when idle, backups).
- [ ] A8 Test mode is on in production. Set `TEST_MODE=0` at launch (and repo variable `SMOKE_EXPECT_LIVE=1`).

## B. Reliability

- [x] B1 TV board shows only 3 ready orders (`ready.slice(1, 3)` in `app/board/Board.tsx`); later ones are invisible.
- [x] B2 Kitchen rail: more than ~4 chits scroll off-screen right with no "more" marker; new orders arrive off-screen. Chime needs "Turn on sound" after every reload.
- [x] B3 Tablets keep old code after a deploy: no version check, no nightly reload.
- [x] B4 No error monitoring or uptime alert (nobody is told when orders fail).
- [-] B5 (owner: not now) Screens can sleep: no Wake Lock; depends on tablet settings.
- [x] B6 PIN lockout is per IP: the shop's devices share one Wi-Fi address, so 10 wrong tries on any device locks kitchen + dashboard for 10 min. Also per server instance (in memory).
- [x] B7 Orders still cooking at midnight IST drop off the kitchen (live list is "today" only).
- [x] B8 On-screen "today" lists stop at 300 orders (`HISTORY_MAX`); reports unaffected.
- [x] B9 TV board downloads the whole day's orders every 10 s to show 8 collected numbers; polls don't pause when the tab is hidden and don't back off when offline.
- [x] B10 A dashboard menu edit saves field by field (several requests); a dropped connection can save half. Change + history line are not atomic.

## C. Ease of use

- [x] C1 Leftover wording: "Take your token", "Getting your token…" → "order number".
- [x] C2 Idli and vada offer "Less oil" and "Extra crisp" notes; cart shows a "Regular sugar" tag for the default.
- [x] C3 Small, pale text: `--cream-3` grey is ~3.5:1 on the background (4.5:1 is the usual minimum); dashboard uses 10–13 px widely. Zoom is disabled everywhere (`maximumScale: 1`), including the phone bill and dashboard.
- [-] C4 (tablet is portrait Android 16:10: fits as built) Kiosk only fits a portrait 800×1280-shaped tablet; on landscape or 4:3 it letterboxes into a narrow strip. Confirm the tablet; decide whether to adapt.
- [-] C5 (owner: photo upload comes with add/remove dishes; caching not chosen) Photos are Wikimedia placeholders; filter coffee has none. Images (110–210 KB) and fonts are served with `max-age=0`.
- [x] C6 No PNG app icons (manifest has SVG only) and no favicon (a 404 on every page).
- [x] C7 (done: corner test tag. Kitchen tags stay as the original boxed tags: the plain-line version was tried and reverted, see log; dashboard restyle not chosen) Design weak spots: dashboard KPI tiles + switch rows look generic; a chit with 6 tags is cluttered; empty lower half of the item sheet and the board's left side when quiet; test ribbon overlaps headings.

## D. Code and long-term upkeep

- [x] D1 `app/kiosk/Kiosk.tsx` (600 lines) and `app/admin/Admin.tsx` (520) hold every screen, with very long lines. Split per screen.
- [x] D2 No linter or formatter (there are `eslint-disable` comments but no ESLint). CSS is dense one-liners with global class names (`.add`, `.st`, `.track`, `.pin`); one clash already broke the kitchen tags.
- [x] D3 Hidden shared state: the active menu is a module-level variable (`setActiveCatalog` in `lib/menu.ts`). Move to React context.
- [-] D4 (owner: not now) Test mode and payment mode are baked into the static kiosk page at build time but read live by the API; they can disagree. Serve them from an endpoint or make the page dynamic.
- [x] D5 Migrations are pasted by hand in the Supabase SQL editor; no record of which ran.
- [x] D6 `lib/store/supabase.ts` is not tested in CI (only by smoke).
- [-] D7 (owner: not now) Reports load every order of the range into memory (`listRange`); a year at 300/day will be slow. Later: SQL aggregates.
- [-] D8 (owner: not now) Single shop only: no `restaurant_id` anywhere.
- [x] D9 Stale docs: `CLAUDE.md` (Realtime, `order_items`, "MockProvider until M6", prototype as source of truth), `docs/BUILD_PLAN.md` (old schema, Razorpay), `README.md`; `prototype/` still has Hindi, dark theme, A-001.
- [x] D10 (done: Dependabot for npm + actions, unused env var removed, blame-ignore for the reformat. `savings`/`roundOff` stay: they are stored columns old bills use. Still for the user: delete merged branches) Housekeeping: delete merged branches (`feat/v1-skeleton`, `feat/owner-admin`, `fix/self-host-fonts`, `fix/smoke-after-deploy`; needs the user, the session can't delete branches); no automatic dependency updates; GitHub actions warn about the Node 20 runtime; dead fields (`savings`, `roundOff`), unused `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## What was found solid

Server prices every order from the menu + owner overrides; idempotent checkout; stale-tablet taps refused;
bad input → 400/404 never 500; PIN lockout; pricing and reports are pure, tested functions; 129 unit/DB
tests (real migrations in PGlite), 40 browser tests incl. network failures, smoke checks after each
production deploy; self-hosted fonts; distinctive, non-generic visual design on kiosk, kitchen, board, bill.

## Decisions log

(date · item · decision)

2026-11-13, owner's choices for B, C, D (A not yet discussed):

| Item | Decision |
|---|---|
| B1 | Fix: newest ready order big, all others in a grid that shrinks to fit |
| B2 | Fix: narrower chits when many + "+N more →" marker. Sound: remember choice, full-width "tap to turn sound on" bar after reload, and flash the screen edge on a new order |
| B3 | Fix: auto-reload after an update (kiosk only on the start screen). No nightly reload |
| B4 | Fix: scheduled GitHub uptime check of `/api/health` during shop hours. No Sentry for now |
| B5 | Not now (keep-awake left to tablet settings) |
| B6 | Raise the limit to 30 wrong PINs per 10 minutes (no per-device lock) |
| B7 | Fix: unfinished orders stay on kitchen/TV past midnight; numbers still restart |
| B8 | Fix: lists page through the whole day |
| B9 | Fix: TV asks only for the last collected numbers; polls pause when hidden, slow down offline |
| B10 | Fix: one request saves a whole menu edit with its history |
| C1 | Fix |
| C2 | Fix both (notes per dish type; hide default choices in the cart) |
| C3 | Fix all three (darker grey, ≥12 px on dashboard, zoom on phone screens only) |
| C4 | No change: kiosk tablet is portrait Android 16:10 |
| C5 | Not now: photo upload comes with the add/remove-dishes work; image caching not chosen |
| C6 | Fix: PNG icons + favicon |
| C7 | Fix: calmer kitchen tags; move the test ribbon. Dashboard restyle not now |
| D1 | Fix: split Kiosk and Admin per screen |
| D2 | Fix: ESLint + Prettier in CI |
| D3 | Fix: menu state in a proper store |
| D4 | Not now |
| D5 | Fix: record which migrations ran; health shows a missing one |
| D6 | Fix: test the Supabase store in CI |
| D7 | Not now |
| D8 | Not now |
| D9 | Fix: refresh docs |
| D10 | Fix: dependency update PRs, newer actions, dead fields. User deletes merged branches |

2026-11-13 · B1 follow-up · owner noticed the TV's smaller ready orders had become plain tiles; they are tickets again (notches + dotted tear line) at every size. Rule: when shrinking something to fit, keep its object shape.

2026-11-13 · design check · compared `main` and the branch side by side with the same orders (TV, kitchen, kiosk cart, dashboard). Two flattenings found and undone: (1) TV small ready tickets are now the original ticket scaled by one unit, not tiles; (2) kitchen tags are the original boxed tags again (plain + / − lines looked cheaper; owner may still choose them). Rule added to CLAUDE.md.
