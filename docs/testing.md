# Testing

Every push runs CI (`.github/workflows/ci.yml`: typecheck, lint, format check, unit + database tests, the store contract on a real Postgres, browser tests). Every push to `main` also waits for Vercel to deploy
it, then runs the read-only smoke checks against production (`.github/workflows/smoke.yml`; any URL
can be checked by hand from the Actions tab → Smoke → Run workflow). A change isn't done until all of these pass.

| Layer | Command | What it proves |
|---|---|---|
| Unit | `npm test` | Pricing (fixed cases + 2,000 seeded random carts: bills add up, whole rupees, GST within 50 paise of 5%, client prices ignored, malformed carts refused); every status move allowed or refused as `NEXT` says; stale-tablet refusal; IST day rollover; live/history time windows; PIN matching + lockout; name cleaning; order-sentence wording. |
| Database | `npm test` (`tests/unit/db.test.ts`) | The real `supabase/migrations/*.sql` in an in-memory Postgres (PGlite): daily numbers 1, 2, 3…, idempotent checkout, first status per payment type, per-day counters, constraints, RLS on, public roles can't call `place_order`. |
| Store contract | `npm test` (memory) · `npm run test:db` (CI `db` job) | One contract (`tests/support/store-contract.ts`) for both stores: idempotent numbered orders, status moves and stale-tablet refusal, live/today/range/collected lists, refunds, menu edits with history, migration log. CI runs it through `lib/store/supabase.ts` against a real Postgres + PostgREST with Supabase's roles and our migrations, and checks the anon key can read and call nothing. |
| Browser flow | `npm run e2e` (project `flow`) | Kiosk → kitchen → TV board → phone bill; cash and UPI counter confirmation; PIN gate; cart asks dine-in/takeaway; 2-minute return to start; busy shelf shrinks to fit. |
| Test mode | `npm run e2e` (project `test-mode`) | Cash counts as paid; ₹1 item. |
| API + failures | `npm run e2e` (project `robustness`) | Bad bodies/ids → 400/404 never 500; server-side prices; idempotent racing double-taps; 25 simultaneous orders get unique numbers; PIN lockout (429); two-tablet stale tap refused; UPI claim/QR rules; bill-QR allow-list; health leaks nothing. Offline banners on kitchen/board and recovery; failed checkout → calm message → one order; reply lost after save → retry gives the same number; double tap → one order; failed kitchen tap reverts; idle reset; UPI QR expiry frees the order; wrong bill link. |
| Busy + long-running | `npm run e2e` (`busy.spec.ts`, project `robustness`) | TV shows every ready order (grid shrinks to fit); a full kitchen rail narrows chits and shows "+N more"; a new order flashes; sound choice remembered with a one-tap reminder after reload; kitchen reloads once for a new build and never loops; kiosk reloads only on the start screen. Unit: orders stay live past midnight, drop after 6 h unfinished, uncapped day list, collected feed carries numbers only; DB: `save_menu_edit` is all-or-nothing, migrations log matches `lib/migrations.ts`. |
| Owner dashboard | `npm run e2e` (project `admin`, own server on 3103) | PIN gate on page + API; bad input on every admin endpoint; sold out greys the kiosk and the server refuses it; a dish selling out mid-order is flagged in the cart; price/name change reaches the next bill, old bills unchanged, history logged; Paid + refund move today's takings; reports + CSV; kiosk keeps the last menu if `/api/menu` fails. Unit: report maths (refunds, split, extras, GST adds up, hours, empty days, previous period), CSV quoting + formula defusing, menu merge, store refunds/overrides/ranges; DB: migration 0003 limits + RLS, migrations re-runnable. |
| Smoke (deployed) | `SMOKE_URL=https://… npm run smoke` | Read-only checks on a live deployment: health, kiosk menu, kitchen PIN gate, board online, API refuses bad input, wrong bill link. Never writes orders. |

Notes:
- e2e builds once and starts three servers (ports 3100–3102) on the **memory store** with Supabase env blanked; every spec refuses to run otherwise. Locally: `PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e`.
- Random tests are seeded, so a failure reproduces on every run.
- In CI a failed e2e run uploads `playwright-report/` + traces as an artifact.
- At launch set the GitHub repo variable `SMOKE_EXPECT_LIVE=1`: production smoke then also fails if test mode is still on.

## Found and fixed by this round (2026-11-13)
- Malformed or `null` request bodies, `null` cart lines and non-list notes crashed with 500 → now 400.
- A non-uuid order id would be a Postgres cast error (500) on Supabase → 404 before touching the DB (the live preview showed the 500).
- 4-digit staff PIN had no guessing limit → 10 wrong PINs per address per 10 minutes, then 429.
- A kitchen tablet that hadn't refreshed could pull another tablet's "ready" order back to cooking → status changes carry the status the tablet saw; the server refuses with 409 if it moved on.
- A wrong phone-bill link spun on "Loading" forever → says it couldn't find the bill.
- Customer names could carry control/direction-override characters onto the TV → stripped.

## Known gaps (not covered yet)
- `lib/store/supabase.ts` itself (the supabase-js calls) is only exercised by the smoke checks, not in CI.
- Orders still on the rail at midnight IST drop off the kitchen (the live list is "today" only). Fine while the shop closes before midnight.
- The PIN lockout is per server instance (in memory); a determined attacker spread over many instances gets more tries. Move it to the database if that matters.
