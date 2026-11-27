# Claude Code working notes — Benne 14

Self-order kiosk, kitchen display, TV order board and owner app for **Benne 14 — Authentic Bangalore Dosa** (Indirapuram). Built for the owner (the user's brother). Read `docs/state.md` every session; `docs/go-live.md` is the plan to launch; `docs/README.md` lists every other doc and what it is for. Tick audit items (`docs/audit.md`, `ui-audit.md`, `accuracy-audit.md`) as they merge.

## Stack

Next.js 15 (App Router, TS strict) · Supabase (Postgres with RLS; server-only access, no Realtime or Auth yet) · Vercel · CSS variables + one CSS file per surface, scoped by a root class · ESLint + Prettier · Vitest + Playwright. Payments: Easebuzz, either its gateway (`PAYMENTS=easebuzz`) or InstaCollect (`PAYMENTS=instacollect`, `lib/instacollect.ts`, its own Wire keys; proven with a real payment on 2026-11-27 and the one the shop is moving to); mock in tests (`PAYMENTS=mock`). Phone notifications by web push.

## Layout

```
app/kiosk  app/admin                 Kiosk.tsx / Admin.tsx hold state; one file per screen in screens/
app/kitchen  app/board  app/r/[id]   kitchen display (Kitchen.tsx + Chit, Pass, Tray, History, hooks), TV board, phone bill
app/api/...                          route handlers: the only code that touches the database
components/                          Fit (scaled fixed-size designs), PinGate, Catalog (menu state via context), Recover (crash screen)
lib/menu.ts  pricing.ts  orders.ts   menu in code + owner overrides (mergeCatalog), pricing + GST, order model
lib/reports.ts  admin.ts  server.ts  dashboard numbers, input cleaning, PINs + lockout + rate limits
lib/client/                          every browser API call and hook, one file per concern; import from '@/lib/client'
lib/gateway.ts  easebuzz.ts          payments; lib/kioskkey.ts the kiosk's signed key
lib/system.ts  watch.ts  push.ts     System page rules, the check that runs them, notifications
lib/tech.ts                          technical page: step timings, grouped errors, the report to paste
scripts/                             serve-local.sh, stop-server.sh
lib/store/memory.ts  supabase/       storage behind one interface (supabase/ has one file per area); both pass tests/support/store-contract.ts
supabase/migrations/                 SQL, run by hand in Supabase in order; listed in lib/migrations.ts
tests/unit  tests/integration  tests/e2e  tests/smoke
```

Commands: `npm run dev` · `npm run check` (typecheck, lint, format check, unit tests) · `npm run format` · `npm run e2e` · `SMOKE_URL=… npm run smoke`. Test layers and what each proves: `docs/testing.md`.

## Design source of truth

- **The running app is the design reference.** `prototype/` is history (the pre-build HTML screens: dark theme, Hindi, old numbering); only `prototype/admin.html` matches what was built.
- Tokens in `app/globals.css` (light theme). Fonts: Big Shoulders (display, prices; Google renamed it from Big Shoulders Display), Familjen Grotesk (body). Both are self-hosted in `public/fonts` (latin + latin-ext, which carries ₹) and declared in `app/globals.css`: no `next/font/google`, so builds never depend on Google.
- Yellow (`--benne`) is for fills and buttons; text/outlines in yellow use `--benne-fg`.
- Avoid generic "AI-looking" UI: no pill-chip clutter for information, no gradients-on-everything, no emoji as icons. Use real objects (tokens, chits, paper slips), short human wording. **English only** (owner's call): no Hindi in the app.
- **Never flatten an approved design.** Before pushing any visual change, render the screen from `main` and from the branch with the same data and compare them side by side (worktree of `main` on another port). When something must shrink or repeat, scale the original object (ticket, chit, slip) with its details intact; don't replace it with a plain tile, row or text line. Report every visual difference to the owner, including ones they asked for.
- For a new screen or a big visual change: show the owner a mockup or screenshot first, get it approved, then build.

## Rules

- The server prices orders from `mergeCatalog(store.getOverrides())`; the client sends ids and choices only. Never price on the server without passing the merged catalog.
- Every order write is idempotent (checkout key + request fingerprint). Tokens come from the DB's per-day counter.
- Money is whole rupees in integer maths (`lib/pricing.ts`, `lib/discounts.ts`); never floating-point arithmetic on amounts. What counts as takings is `counts()` in `lib/orders.ts`, nowhere else. A paid order is refunded, never cancelled.
- Order lines are a JSON snapshot (names, prices) on the order, so menu changes never alter past bills.
- Kitchen/board must recover by themselves: polling through `usePoll`, visible offline state, auto-reload after a deploy.
- The menu reaches components through `useCatalog()` / an explicit `catalog` argument, never a module-level variable.
- A new migration: add the SQL file, add its name to `lib/migrations.ts`, make it record itself in `schema_migrations`, and tell the user to run it.
- A gateway payment is confirmed in one place, `settle()` in `lib/gateway.ts`, by asking the gateway directly; never from a webhook or client message alone.
- `POST /api/orders` needs a kiosk key (`x-kiosk-key`, `lib/kioskkey.ts`); `/api/admin/*` needs the owner PIN (`adminDenied`), kitchen actions the staff PIN (`staffCheck`). A new route picks one of the three on purpose, or says in a comment why it is open.
- Secrets only from env (`.env.local`, Vercel, cloud environment settings). Never commit or paste keys.
- Every feature: at least one unit test (logic) and one Playwright test (user-visible flow). API inputs also get a bad-input case in `tests/e2e/api.spec.ts`; anything that talks to the network gets a failure case in `tests/e2e/resilience.spec.ts`.
- No new dependency without a one-line reason in the PR.
- Keep files small and about one thing. When a screen or module passes about 400 lines, split it the way `app/kitchen/` and `lib/client/` are split: move code, don't rewrite it, and keep the import path the same.

## Workflow

- One milestone = one branch (`feat/<slug>`, `fix/…`, `chore/…`) off `main` = one PR = one Vercel preview. Merge when CI is green and the owner has seen it; delete the branch after.
- Before pushing: `npm run check` and `npm run e2e`.
- Test the preview on the real device (tablet/TV) before merging to `main`.
- Commits: imperative, one short sentence; body explains why.
- Update `docs/state.md` at the end of each milestone (Done log with date + one-line outcome).
- Docs: one fact in one file; edit in place when something stops being true; a new doc gets a row in `docs/README.md`.

## Working with the owner

- Not a programmer and often on a phone: plain language, no jargon, short reports.
- Ask before deciding anything they would notice: yes/no questions with a suggested answer.
- Never merge without their word. Paste migration SQL inline in the chat (they can't open files on the phone).
- Changing anything on a Vercel preview changes the real database (previews share it). Deleting data needs an explicit go-ahead.

## Vercel settings (the owner changes these; we can only read the result)

- What the live site is running: `GET /api/health` on the live address (`payments`, `testMode`, `build`, `migrations`) and `GET /api/kiosk` (`cash`). Read-only; check it after every settings change instead of trusting that it took.
- A setting only takes effect after a redeploy, and only in the environments it is ticked for. `PAYMENTS` exists twice in Vercel, once for Production and once for Preview: edit each on its own (making one cover both fails with "already exists").
- InstaCollect needs `PAYMENTS=instacollect` plus `EASEBUZZ_WIRE_KEY` and `EASEBUZZ_WIRE_SALT`. The gateway's `EASEBUZZ_KEY` is refused by InstaCollect ("Invalid key"). Owner app → System → Technical detail → Check InstaCollect proves the keys with no money moving.
- Test mode is off unless `TEST_MODE=1` (previews only). Cash at the kiosk is not a Vercel setting: owner app → Offers → On the kiosk → Cash, off by default.
- Keys go into Vercel, never the chat. The Wire pair was once pasted in chat (2026-11-21): ask Easebuzz for a fresh pair before launch.

## Debugging a live problem

- Ask the owner for the technical report first: owner app → System → Technical detail → Copy report, pasted into the chat. It has the build, settings as on/off, what needs a look, every screen, step timings, grouped errors with stack traces, stuck payments and kitchen pace, and the database's size. Rules in `lib/tech.ts`.
- A step worth watching gets `timed('area.step', fn)` from `lib/server.ts` (third argument `true` for anything that runs all day: only slow or failed runs are kept) and a name in `OP_NAME`.

## Running things in a Claude session

- The session may hold the live Supabase keys. Local servers must blank them: use `scripts/serve-local.sh [port]` (in-memory store, mock payments, staff PIN 2468, owner PIN 246810). e2e already blanks them and refuses otherwise.
- Stop servers with `scripts/stop-server.sh`, in its own command. Never `pkill -f next`: it kills the shell.
- e2e here: `rm -rf .next && PW_CHROMIUM=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npm run e2e -- --trace off` (add `--project=flow|test-mode|robustness|admin|gateway|day|load|android` for one suite; `iphone` needs WebKit and runs only in CI). The real-Postgres store tests run only in CI: wait for that job before merging store changes.
- Side-by-side compare: `git worktree add ../benne14-main main`, serve each with `scripts/serve-local.sh` on its own port, screenshot both with the same data.
- Tests that hit a rate-limited open endpoint send their own `x-forwarded-for`.
