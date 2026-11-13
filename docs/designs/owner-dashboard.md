# Owner dashboard (M4): plan

Status: **mockups waiting for approval** (`prototype/admin.html?s=today|orders|order|menu|edit|reports|log|login`).

## Decisions so far (from the brainstorm, 2026-11-13)

| Question | Decision |
|---|---|
| Who / device | Owner only, on his phone (390 px wide, bottom tabs) |
| Login | Email + password (Supabase Auth), separate from the kitchen PIN |
| v1 must-haves | Today's sales + payment split; sold-out + prices; reports + CSV |
| Menu editing | Sold-out, price, name, description (and extras' prices). Adding dishes, photos, new add-ons stay with us |
| Sold out | Greyed out on the kiosk with "Sold out"; switches back on by itself the next morning |
| Menu refresh | The kiosk picks up changes when it returns to the start screen (next customer) |
| Reports | Day/week/month/custom takings with comparison; dish-wise; busy hours; GST summary; CSV exports |
| Order actions | Today's list; confirm cash/UPI ("Paid"); cancel unpaid; record refunds |
| Refunds | Recorded only (money goes back via Paytm app / cash drawer), full amount, with a reason |
| Settings (PIN, test mode, hours) | Not in v1; stay in Vercel |
| Change history | Yes: every price/name/description/sold-out change and every refund, with time |
| Design | Mockups approved first, then build |

## Screens

1. **Sign in**: email + password; "Forgot password" via Supabase email.
2. **Today**: takings slip (total, vs same weekday last week, orders, average bill, refunds, UPI/card/cash split); **Needs you** (payments to confirm, with Paid); kitchen now (waiting / on the tawa / ready); selling today; busy hours.
3. **Orders**: today's list (All / To confirm / Cancelled); tap → order sheet with bill, timeline, and actions: Paid (unpaid), Cancel (unpaid), Refund (paid, needs a reason).
4. **Menu**: dishes by category with an On/Off switch; tap → edit sheet (price with the with-GST preview, kiosk name, description, extras' prices). Link to change history.
5. **Reports**: Day / Week / Month / Custom, step back and forward; takings, orders, average bill, refunds vs the previous period; by-day bars; dish-wise table (+ extras); busy hours; GST block (taxable value, CGST, SGST, total); CSV downloads (every bill, GST by day, dish-wise).
6. **History**: menu changes and refunds, newest first.

## How it will work (technical)

- **Menu moves to the database, the catalogue stays in code.** New table `menu_overrides(item_id, name, desc, price, sold_out_on date)` and `option_overrides(group_id, option_id, price)`. `lib/menu.ts` stays the list of dishes, groups and photos; the server merges overrides on top. Pricing (`place_order`) uses the merged menu, so a tampered kiosk still can't change a bill. `sold_out_on = today (IST)` means sold out today only, so it switches back on by itself next morning.
- **Kiosk** fetches `/api/menu` when it shows the start screen; sold-out dishes greyed with "Sold out"; the server refuses a sold-out dish (with a friendly message) in case the kiosk was a step behind.
- **Refunds**: new columns on `orders`: `refunded_at`, `refund_reason`, `refund_amount`. Reports subtract them. A refunded order stays visible, struck through.
- **Change log**: `admin_events(at, kind, item, before, after, note)`, written by the same server calls that change things.
- **Auth**: Supabase Auth email/password; the owner's email is listed in an env var `OWNER_EMAILS`; every `/api/admin/*` route checks the session server-side. Kitchen PIN doesn't open the dashboard.
- **Reports** are computed on the server from `orders` (IST days); CSV built server-side. Bills are snapshots, so later price changes never change past reports.
- Tests: unit (overrides merge, report maths incl. refunds, GST totals, CSV), DB (new migration in PGlite), e2e (sign-in gate, sold-out reaches the kiosk, price change reaches the next bill, refund changes the report, bad-input cases), smoke (dashboard sign-in page loads).

## Open questions for the owner

- Which email should be the owner login?
- Average bill / comparisons: compare with the same weekday last week (as drawn), or with yesterday?
- Busy hours: shop hours to show on the chart (drawn 8 am–7 pm)?
- Should cancelled-unpaid QR orders appear in reports at all (drawn: only in the Orders list)?
