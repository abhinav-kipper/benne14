# Claude Code working notes — Benne 14

Self-order kiosk, kitchen display, TV order board and owner admin for **Benne 14 — Authentic Bangalore Dosa** (Indirapuram). Built for the owner (the user's brother). Plan and milestones: `docs/BUILD_PLAN.md`. Live status: `docs/state.md` (read it every session).

## Stack

Next.js 15 (App Router, TS strict) · Supabase (Postgres, Realtime, Auth, RLS) · Vercel · CSS variables + one CSS file per surface, scoped by a root class (ported from the prototype) · Vitest + Playwright. Payments behind a `PaymentProvider` interface; `MockProvider` until M6.

## Layout

```
app/kiosk  app/kitchen  app/board  app/r/[id]   screens (client components inside a <Fit w h> frame)
app/api/orders/...                              order API: place, live, status, mock pay, UPI QR
lib/menu.ts  lib/pricing.ts  lib/orders.ts      menu (v1, in code), pricing + GST, order model
lib/store/{memory,supabase}.ts                  storage: Supabase when env is set, memory otherwise
supabase/migrations/                            SQL to run in Supabase
tests/unit  tests/e2e                           Vitest, Playwright
```

Commands: `npm run dev` · `npm run typecheck` · `npm test` · `npm run e2e`.

## Design source of truth

- `prototype/` holds the approved screens as static HTML. Port them faithfully; don't redesign while building.
- Tokens in `prototype/theme.css` (light is the default theme; dark is kept). Fonts: Big Shoulders (display, prices; Google renamed it from Big Shoulders Display), Familjen Grotesk (body), Tiro Devanagari Hindi (Hindi).
- Yellow (`--benne`) is for fills and buttons; text/outlines in yellow use `--benne-fg`.
- Avoid generic "AI-looking" UI: no pill-chip clutter for information, no gradients-on-everything, no emoji as icons. Use real objects (tokens, chits, paper slips), short human wording, Hindi where the reader is Hindi-first (kitchen staff).
- When a screen needs to change: update the prototype, re-render (`THEME=light node prototype/shots-all.js`), get it approved, then build.

## Rules

- The server prices orders (`place_order` RPC); the client sends ids and choices only.
- Every order write is idempotent (checkout key). Tokens come from the DB's per-day counter.
- Snapshot names and prices into `order_items`.
- Kitchen/board must recover by themselves: Realtime reconnect + polling fallback, visible offline state.
- Secrets only from env (`.env.local`, Vercel, cloud environment settings). Never commit or paste keys.
- Every feature: at least one unit test (logic) and one Playwright test (user-visible flow).
- No new dependency without a one-line reason in the PR.

## Workflow

- One milestone = one branch (`feat/<slug>`) = one PR = one Vercel preview.
- Test the preview on the real device (tablet/TV) before merging to `main`.
- Commits: imperative, one short sentence; body explains why.
- Update `docs/state.md` at the end of each milestone (Done log with date + one-line outcome).
