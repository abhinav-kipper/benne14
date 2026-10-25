# Claude Code working notes — Benne 14

Self-order kiosk, kitchen display, TV order board and owner admin for **Benne 14 — Authentic Bangalore Dosa** (Indirapuram). Built for the owner (the user's brother). Plan and milestones: `docs/BUILD_PLAN.md`. Live status: `docs/state.md` (create it at M0).

## Stack

Next.js 15 (App Router, TS strict) · Supabase (Postgres, Realtime, Auth, RLS) · Vercel · CSS variables + CSS Modules · Vitest + Playwright. Payments behind a `PaymentProvider` interface; `MockProvider` until M6.

## Design source of truth

- `prototype/` holds the approved screens as static HTML. Port them faithfully; don't redesign while building.
- Tokens in `prototype/theme.css` (light is the default theme; dark is kept). Fonts: Big Shoulders Display (display, prices), Familjen Grotesk (body), Tiro Devanagari Hindi (Hindi).
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
