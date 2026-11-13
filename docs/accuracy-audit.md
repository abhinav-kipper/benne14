# Accuracy audit: money, order numbers, reports

Date: 2026-11-14, on `main` at `867de31`. Scope: everything that decides what a customer is charged,
which order number they get, what state an order is in, and what the owner's dashboard and CSVs say.
Method: read the pricing, order, store, report and API code and the SQL migrations; ran probes
(every whole-rupee total up to ₹2,00,000 through the GST and discount maths; a paid order cancelled;
1,001 orders summed). Nothing was changed. Security and hosting are in `docs/audit.md`.

Legend: `[ ]` open · `[x]` done · `[-]` decided not to do. **High** = can produce a wrong charge, a
wrong order or a wrong report today. **Medium** = correct today, but nothing stops it going wrong.
**Decide** = a business or accountant's call, not a bug.

## What is already tight (verified)

- The server prices every order from its own menu; the client's prices are ignored (tested).
- GST and discount rounding: the float formulas give the same answer as exact integer maths for every
  item total from ₹1 to ₹2,00,000 and every percentage 1–90 (probe: 0 mismatches).
- Bills add up: taxable + CGST + SGST = total, in whole rupees, for 2,000 random carts (existing test)
  and across 1,001 summed orders (probe). Dishes + extras − discounts = taxable value (probe).
- Order numbers come from one database counter per day, in the same transaction as the order.
- A retried checkout with the same key returns the same order (tested in both stores).
- A stale tablet cannot undo another tablet's tap (tested). Refunds are recorded once (tested).
- Order lines are a snapshot, so later menu changes never alter an old bill (tested).
- The memory store and the Supabase store pass the same contract tests; migrations run in CI.

## A. Can go wrong today (High)

- [ ] **A1 An edited cart can be saved as the old order.** The kiosk keeps one checkout key per
  customer (`app/kiosk/Kiosk.tsx`) and only renews it on reset or "Other ways to pay". If a checkout
  reaches the server but the reply is lost, and the customer then goes back, changes the order (or
  picks cash instead of UPI) and pays again, the server sees the same key and returns the **first**
  order: old dishes, old total, old payment type. The kitchen cooks the old cart.
  Fix: the server stores a fingerprint of the request with the key and refuses (409) a different
  request under the same key; the kiosk takes a new key whenever the cart, type, code or payment
  method changes.
- [ ] **A2 A paid order can be cancelled and simply vanishes from the takings.** The state machine
  allows `new → cancelled` (`lib/orders.ts` `NEXT`). The screens don't offer it, but the API accepts
  it with the staff PIN. Probe: takings ₹219 → ₹0, no refund recorded, not in the bills CSV.
  Fix: once paid, an order can only be refunded, never cancelled. Remove the move; test every pair.
- [ ] **A3 The amount on the pay screen can differ from what is charged.** The pay screen shows the
  kiosk's own total; the order is priced by the server. If a price, sold-out state or code changed
  in between, the customer sees one amount and the UPI QR or counter asks another, with no notice.
  Fix: the kiosk sends the total it showed; the server refuses (409, "prices changed, please check
  your order") when its own total differs, and the kiosk reloads the menu.
- [ ] **A4 Two definitions of "takings".** The kitchen's Today panel counts refunded orders
  (`app/kitchen/Kitchen.tsx`), the dashboard doesn't; `app/admin/screens/Orders.tsx` has a third
  copy of the rule. After a refund the kitchen and the dashboard disagree.
  Fix: one exported rule (`counts` in `lib/reports.ts`) used by every screen.
- [ ] **A5 Test orders are mixed into the real books.** Test mode is on in production, and there is
  no way to tell a test order from a real one or to start clean. Reports, the customer list and
  order numbers will carry the test data into launch.
  Fix: a go-live step (SQL the owner runs once) that archives or deletes test orders, plus
  `TEST_MODE=0` (`docs/audit.md` A8).

## B. Correct today, but not locked (Medium)

- [ ] **B1 Money is floating-point rupees.** Results are right (probe), but by coincidence of the
  values, not by construction. Fix: do GST and discount in integer paise/rupees with explicit
  round-half-up, and keep the exhaustive comparison as a permanent test.
- [ ] **B2 The database accepts a bill that doesn't add up.** `orders` has no rule that
  `subtotal + cgst + sgst + round_off = total`, that amounts are ≥ 0, or that a discount has a code.
  Fix: CHECK constraints (migration), tested with bad rows.
- [ ] **B3 A saved bill can be edited.** Nothing stops an UPDATE from changing an order's lines or
  totals after it is placed. Fix: a trigger that refuses changes to the money columns, lines, order
  number and day (status, timestamps and refund fields stay editable).
- [ ] **B4 No record of who changed an order's state, or when.** Only the latest `updated_at`,
  `paid_at`, `ready_at` exist. A payment dispute ("who marked 42 paid, and when?") can't be answered.
  Fix: an append-only `order_events` table written in the same statement as each status change,
  shown on the dashboard's order sheet.
- [ ] **B5 A double submit can skip an order number.** Two simultaneous requests with the same key
  both take a number; one is discarded, leaving a gap (44, 46). Harmless for customers, wrong if
  numbers are ever used as invoice numbers. Fix: lock on the key before taking a number.
- [ ] **B6 Order numbers under load are only tested on the in-memory store.** Fix: the same
  "30 kiosks at once" test against real Postgres in CI.
- [ ] **B7 Checks happen before the idempotency lookup.** A retry of an order that was already
  saved can be refused (dish sold out or code switched off in between) although the order exists.
  Fix: look the key up first and return the saved order.
- [ ] **B8 The report rules are not tested as identities.** Add property tests over random days of
  orders: summary total = sum of bills CSV = sum of GST-by-day CSV; split by payment = takings;
  dishes + extras − discounts = taxable; refunds never counted twice.
- [ ] **B9 Old rows mean something else.** Orders from before 12 Nov may carry a `savings` or
  `round_off` from the old 14% discount and round-off rules; the new bill would label that a code
  discount. Goes away with A5's clean start; otherwise needs a one-time fix-up.

## C. For the owner and the accountant (Decide)

- [ ] **C1 Invoice numbers.** The bill carries the daily order number (1, 2, 3… every day). A GST
  tax invoice needs a number that is unique and consecutive within the financial year, plus GSTIN
  and address (`docs/ui-audit.md` U10). Proposal: a separate invoice number given when the order is
  paid, gap-free, e.g. `B14/26-27/000123`; cancelled and unpaid orders never get one.
- [ ] **C2 A refund changes a past day.** A refund recorded today removes the order from the day
  it was placed, so yesterday's closed figures change. Alternative: the sale stays on its day and
  the refund shows as a negative on the day it was made (how a credit note works). Ask the CA.
- [ ] **C3 Which day does a sale belong to?** Reports use the day the order was placed. An order
  placed at 23:58 and paid at 00:05 counts for the first day. Fine if agreed.
- [ ] **C4 One GST rate.** Everything is charged 5%. If the shop ever sells something at another
  rate (packaged drinks), pricing needs a rate per dish.
- [ ] **C5 Cash is not reconciled.** The app knows cash takings but there is no end-of-day count
  ("drawer should hold ₹X"). A small day-close screen would catch counter mistakes.

## Suggested order

1. **A1–A4 and B1, B6–B8** in one PR: code and tests only, no database change.
2. **B2–B5** in a second PR with one migration (constraints, immutability, order events, key lock).
3. **A5** when the owner is ready to launch; **C1–C5** after talking to the accountant.

## Decisions log

(date · item · decision)
