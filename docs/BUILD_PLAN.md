# Benne 14 — build plan

From the HTML prototype in `prototype/` to a real system running in the restaurant: kiosk, kitchen display, TV board and owner admin. Goal: **quick, fast, reliable, clean** — in that order of what the customer feels.

## What we're building

| Surface | Device | Route | Prototype |
|---|---|---|---|
| Kiosk | Android tablet, portrait, mounted | `/kiosk` | `kiosk-*.html` |
| Kitchen display | Tablet in the kitchen, landscape | `/kitchen` | `kitchen.html` |
| Order board | TV at the counter, 1920×1080 | `/board` | `board.html` |
| Phone receipt + live tracking | Customer's phone (QR on token screen) | `/r/[orderId]` | — |
| Owner admin | Owner's phone | `/admin` | not designed yet |

Light theme is the default (owner's call). Dark stays available as a token set.

## Stack

| Piece | Choice | Why |
|---|---|---|
| App | **Next.js 15** (App Router), TypeScript strict | Same as the dance app; one codebase serves all five surfaces |
| Styling | **CSS variables + CSS Modules** | The prototype is plain CSS on tokens (`theme.css`); it ports almost line for line, no new framework to learn |
| Data | **Supabase** Postgres + Realtime + Auth + RLS | Orders appear on the kitchen/TV instantly via Realtime; RLS keeps each device to its job |
| Hosting | **Vercel** | Preview URL per branch → test on the real tablet before merging |
| Payments | `PaymentProvider` interface, `MockProvider` now | Razorpay drops in later without touching screens |
| Fonts | Big Shoulders Display, Familjen Grotesk, Tiro Devanagari Hindi via `next/font` | Self-hosted, no layout shift, works offline once cached |
| Tests | Vitest (logic) + Playwright (flows, incl. kiosk→kitchen→board across three pages) | Same as the dance app |

No other dependencies until something earns its place.

## Architecture in one picture

```
Kiosk ──place_order()──► Postgres (orders, order_items, payments)
  │   (server action → RPC: re-prices from DB, assigns token, idempotent)
  │                         │
  └─ mock pay ──────────────┤ Realtime (orders channel)
                            ├──► Kitchen: new → cooking → ready → handed over
                            ├──► Board: on the tawa / ready
                            └──► Phone tracker /r/[id]
Admin ──prices, sold-out──► menu tables ──Realtime──► Kiosk greys out instantly
```

### Data model (first cut)

- `menu_categories(id, name, name_hi, sort)`
- `menu_items(id, category_id, name, name_hi, desc_hi, price, mrp, photo_url, is_available, is_special, sort)`
- `modifier_groups(id, item_id, name, min, max)` / `modifiers(id, group_id, name, price)` — spice, extras
- `kitchen_notes(id, label, label_hi)` — the one-tap notes
- `orders(id, token, token_day, type dine_in|takeaway, customer_name, status, subtotal, gst, total, created_at, …)`
  - status: `pending_payment → paid → cooking → ready → handed_over` (+ `cancelled`); cash orders sit at `awaiting_cash`
- `order_items(order_id, item_id, name_snapshot, price_snapshot, qty, modifiers jsonb, notes text[])` — snapshots so later price edits never change old bills
- `payments(order_id, method upi|card|cash, provider_ref, status, amount)`
- `devices(id, role kiosk|kitchen|board|admin, name)`
- `restaurant_id` on every table from day one (cheap now, painful later)

### Rules that keep it correct

- **The server prices every order.** The kiosk sends item ids + choices only; `place_order()` reads prices from the DB. A tampered tablet can't change a bill.
- **Idempotency key per checkout**, so a double tap or a retry never makes two orders.
- **Tokens** come from a Postgres function with a per-day counter (`A-001`, resets daily) — no clashes with two kiosks.
- **Order exists before payment** (`pending_payment`); payment success flips it to `paid`, and only paid (or cash-confirmed) orders reach the kitchen.

## Reliability (the restaurant can't stop because Wi-Fi blinked)

- Kiosk is an installed PWA in full-screen **kiosk mode** (Fully Kiosk Browser or Android screen pinning), screen kept awake (Wake Lock), pinch-zoom and long-press disabled.
- Menu + photos cached by the service worker: the kiosk opens and browses even offline; checkout shows a clear "reconnecting" state instead of failing silently.
- Kitchen/board: Realtime with **auto-reconnect + 5-second polling fallback**, and a visible "offline" dot. Kitchen plays a chime on new orders (needs one tap after boot to unlock audio — part of the morning start-up).
- Auto-reload on unrecoverable errors; a nightly reload to clear memory.
- Every screen survives a refresh mid-order (state in the DB, not only in memory).

## Speed

- Kiosk first paint < 1 s on the tablet: menu served statically (ISR, revalidated on menu edit), photos pre-sized WebP via `next/image`, fonts self-hosted.
- No client-side data fetching on the menu path; cart lives in memory + `sessionStorage`.
- Measure on the actual tablet (Chrome remote devtools), not a laptop.

## Milestones

Each one is a branch → PR → Vercel preview → **tested on the real device** → merge. Each has a demo you can show your brother.

| # | Milestone | Done when |
|---|---|---|
| M0 | **Foundation**: Next.js + Supabase + Vercel, CI, lint, tests, `theme.css` ported as tokens (light default), fonts, schema + seed with the real menu | Empty app deploys; menu rows visible in Supabase |
| M1 | **Kiosk ordering**: home → menu → item → cart → pay (mock UPI/card/cash) → token | Order lands in DB with correct prices, token and snapshots; unit tests for pricing + GST + token |
| M2 | **Kitchen display**: rail of chits, start/ready/handed over, undo, chime, ageing timers | Order from the kiosk appears on the kitchen tablet in < 2 s; Playwright test across both pages |
| M3 | **TV board + phone tracker** | Ready token pops on the TV; `/r/[id]` shows live status and GST bill |
| M4 | **Owner admin** (design first, then build): price edit, sold-out toggle, today's sales, cash confirmation | Price change shows on the kiosk without a reload |
| M5 | **Hardening on site**: kiosk mode, offline states, reconnects, nightly reload, error logging | One full lunch service with no staff intervention |
| M6 | **Real payments**: Razorpay UPI QR + webhook (replaces mock) | Real ₹1 test payment end to end |
| Later | Receipt printer (once the model is known), WhatsApp bill, loyalty, Swiggy/Zomato | — |

## Moving this into Claude Code

1. **Start a new Claude Code session on this repo** (`abhinav-kipper/benne14`). It reads `CLAUDE.md` first — that file holds the conventions so you don't repeat them.
2. **Secrets go in the environment, never in chat**: add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (and later `RAZORPAY_*`, `ELEVENLABS_API_KEY`) in the cloud environment's settings → secrets, and in Vercel for deploys.
3. **One milestone per session.** Open with a prompt like:
   > Build M1 from docs/BUILD_PLAN.md. Port the kiosk screens from prototype/kiosk-*.html faithfully (light theme). Plan first, then implement on a feature branch, with unit tests for pricing and a Playwright test for the order flow. Push for a Vercel preview.
4. **Review on the real tablet** using the Vercel preview URL (pin it as a second PWA, like the dance app's preview PWA). Merge only after it feels right on the device.
5. Keep `docs/state.md` as the live "where are we" file; Claude updates it at the end of each milestone.
6. The prototype stays the design source of truth. When a screen changes, update the prototype first, re-render (`THEME=light node prototype/shots-all.js`), agree on it, then build.

## Questions for your brother (before M1)

1. Tablet model and Android version (for kiosk mode and Chrome version).
2. Prices on the menu — GST inclusive or exclusive?
3. Cash orders: cook immediately, or only after the counter confirms payment?
4. Receipt printer — does he have one (model?) or is phone-bill-only fine to start?
5. Real menu photos — can he shoot 10 dishes on a plain surface in daylight?
6. Shop Wi-Fi reliability — do we need a 4G backup on the kiosk?
