# Claude Code working notes — Benne 14

Self-order kiosk, kitchen display, TV order board and owner admin for **Benne 14 — Authentic Bangalore Dosa** (Indirapuram). Built for the owner (the user's brother). Live status: `docs/state.md` (read it every session). How it works: `docs/ARCHITECTURE.md`. Payments: `docs/payments.md`. Open issues and what's fixed: `docs/audit.md` (system), `docs/ui-audit.md` (UI and customer flow) and `docs/accuracy-audit.md` (money, order numbers, reports); tick items as they merge.

## Stack

Next.js 15 (App Router, TS strict) · Supabase (Postgres with RLS; server-only access, no Realtime or Auth yet) · Vercel · CSS variables + one CSS file per surface, scoped by a root class · ESLint + Prettier · Vitest + Playwright. Payments behind a `PaymentProvider` interface: direct UPI in production, `MockProvider` in tests.

## Layout

```
app/kiosk  app/admin                 Kiosk.tsx / Admin.tsx hold state; one file per screen in screens/
app/kitchen  app/board  app/r/[id]   kitchen display, TV board, phone bill
app/api/...                          route handlers: the only code that touches the database
components/                          Fit (scaled fixed-size designs), PinGate, Catalog (menu state via context)
lib/menu.ts  pricing.ts  orders.ts   menu in code + owner overrides (mergeCatalog), pricing + GST, order model
lib/reports.ts  admin.ts  server.ts  dashboard numbers, input cleaning, PIN + lockout
lib/store/{memory,supabase}.ts       storage behind one interface; both pass tests/support/store-contract.ts
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
- Secrets only from env (`.env.local`, Vercel, cloud environment settings). Never commit or paste keys.
- Every feature: at least one unit test (logic) and one Playwright test (user-visible flow). API inputs also get a bad-input case in `tests/e2e/api.spec.ts`; anything that talks to the network gets a failure case in `tests/e2e/resilience.spec.ts`.
- No new dependency without a one-line reason in the PR.

## Workflow

- One milestone = one branch (`feat/<slug>`, `fix/…`, `chore/…`) off `main` = one PR = one Vercel preview. Merge when CI is green and the owner has seen it; delete the branch after.
- Before pushing: `npm run check` and `npm run e2e`.
- Test the preview on the real device (tablet/TV) before merging to `main`.
- Commits: imperative, one short sentence; body explains why.
- Update `docs/state.md` at the end of each milestone (Done log with date + one-line outcome).
