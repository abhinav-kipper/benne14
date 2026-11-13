# How the app works

One Next.js 15 app (App Router, TypeScript strict) on Vercel. Screens are client components that talk
to route handlers under `app/api`; the handlers are the only code that touches the database.

## Layout

```
app/kiosk/Kiosk.tsx + screens/      kiosk: cart + screen switching; one file per screen
app/kitchen/Kitchen.tsx             kitchen display
app/board/Board.tsx                 TV order board
app/r/[id]/Receipt.tsx              phone bill + live status
app/admin/Admin.tsx + screens/      owner dashboard: PIN gate + tabs; one file per tab
app/api/...                         route handlers (below)
components/                         Fit (fixed-size design scaled to the device), PinGate, Catalog (menu state)
lib/menu.ts                         the dishes, extras and notes, in code + merge with the owner's changes
lib/pricing.ts                      prices a cart: extras, 5% GST rounded to the rupee
lib/orders.ts                       order model, status rules, IST day helpers
lib/reports.ts                      dashboard numbers and CSV, pure functions over orders
lib/store/                          storage: memory.ts (dev, tests) and supabase.ts (production), one interface
lib/client.ts                       browser API calls and polling hooks
lib/server.ts, lib/admin.ts         request helpers: JSON bodies, staff PIN + lockout, input cleaning
supabase/migrations/                SQL, run by hand in order; logged in schema_migrations
```

## Data

- `orders`: one row per order. `lines` is a JSON snapshot of what was bought (names, prices, extras,
  notes at order time), so later menu changes never alter a past bill or report. Totals, GST, payment
  method, status, timestamps, refund fields.
- `token_counters`: last order number per IST day. `place_order()` is the only way orders are created:
  it is idempotent on the checkout key and hands out 1, 2, 3… per day.
- `menu_overrides`, `option_overrides`: the owner's changes on top of `lib/menu.ts` (price, name,
  description, sold out today; extras' prices). `save_menu_edit()` writes an edit and its history in one transaction.
- `admin_events`: change history (menu edits, refunds). `schema_migrations`: which SQL files ran.
- Row-level security is on with no policies: only the server (secret key) reads or writes.

## Order life

`pending_payment` (UPI QR showing) → `awaiting_cash` (customer says paid / card / cash at counter) →
`new` → `cooking` → `ready` → `handed_over`; `cancelled` from the unpaid states. Allowed moves are the
`NEXT` table in `lib/orders.ts`. Every staff move carries the status the tablet last saw, and the server
refuses it (409) if the order moved on, so two tablets can't undo each other.

## Rules that keep it correct

- **The server prices every order** from `mergeCatalog(store.getOverrides())`. The kiosk sends dish ids
  and choices only. A sold-out dish is refused.
- **Checkout is idempotent** (one key per checkout): retries and double taps make one order.
- **Screens poll** (kitchen and TV every 1.5 s) through `usePoll`: paused while hidden, backing off
  after failures, with a visible offline state. No Realtime.
- **Unfinished orders stay live for 6 hours** regardless of date; history and reports are per IST day.
- **Open screens reload themselves after a deploy** (`/api/version` vs the build they loaded); the kiosk
  only on its start screen.
- **Staff PIN** in the `x-staff-pin` header guards kitchen actions and the whole dashboard API, with a
  lockout after 30 wrong tries per address per 10 minutes.

## API

| Route | Who | What |
|---|---|---|
| `POST /api/orders` | kiosk | place an order |
| `GET /api/orders` (`?view=today`, `?view=collected`) | kitchen, TV, dashboard | live orders / today's history / last collected numbers |
| `GET /api/orders/[id]`, `/upi` | kiosk, phone | one order; its UPI QR while unpaid |
| `POST /api/orders/[id]/claim` | kiosk | "I've paid" or cancel, only while the QR is open |
| `POST /api/orders/[id]/status` | staff PIN | move an order |
| `GET /api/menu` | all screens | the owner's menu changes |
| `/api/admin/*` | staff PIN | report, CSV export, menu edit, refund, change history |
| `GET /api/health`, `/api/version` | anyone | setup check (no secrets); running build |

Known gaps in who may call what are tracked in `docs/audit.md` section A.

## Payments

Direct UPI to the shop's own Paytm UPI ID with a per-order QR; staff confirm on the soundbox. Card and
cash are confirmed at the counter. `PAYMENTS=mock` swaps in a fake payee for tests. Details and the
route to automatic confirmation: `docs/payments.md`.

## Tests and delivery

`docs/testing.md`. Every push runs typecheck, lint, format check, unit + database tests, the store
contract on a real Postgres, and the browser suites; every push to `main` is smoke-checked on the live
site after Vercel deploys it; an uptime check runs during shop hours.

## Discount codes and phone numbers

- **Codes** live in `discount_codes` (owner makes them in the dashboard's Offers tab). A code is a
  percentage or a flat amount, with an optional minimum order, cap and last day. It comes off the item
  total **before GST**; `orders.savings` holds the amount, `orders.discount_code` the code, and
  `orders.subtotal` is the taxable value after the discount (so reports and the GST export stay right).
- The kiosk asks `/api/discounts/check` whether a code works, only to show it; the order is priced again
  at checkout (`priceOrder(lines, catalog, rule)`). A code that stopped working, or an order under the
  code's minimum, is refused with a message rather than charged in full. Ten wrong codes from one
  address in ten minutes are cut off.
- **Phone numbers** are optional and only taken next to a line saying they are for offers from Benne 14,
  so a stored number carries consent (the first order's date is the consent date). The number is stored on
  the order row but is **not part of the `Order` object**: orders are read by the TV, the phone bill and
  public endpoints. Only `Store.listCustomers()` (the `customers` view, paid orders only) reads it, behind
  the PIN. The app sends no messages; the list downloads as CSV.
- **Switches**: `kiosk_settings` (one row) says whether the kiosk shows the code box and the phone box.
  `/api/kiosk` tells the kiosk on every start screen; the code box also needs one usable code. With a
  switch off the server ignores a number and refuses a code, whatever the client sends.
- Before migration 0005 is run, the Supabase store answers "no codes, both switches off" and orders
  still go through.
