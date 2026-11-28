# State — Benne 14

Live "where are we". Keep it skimmable; history goes in the Done log.

## Now

**Live on `main`** (production: https://benne14-git-main-abhinav-mudgal-s-projects.vercel.app, check
`/api/health`). Kiosk, kitchen, TV board, phone bill and owner dashboard all work end to end on
Supabase. UPI is confirmed automatically through Easebuzz's payment gateway (`PAYMENTS=easebuzz`). Not launched to customers yet: test mode is on, and the launch blockers in `docs/audit.md`
section A are open.

## Up next

**The plan to launch is `docs/go-live.md`**: four stages, stage 1 is what must be done before the first real customer.

1. **Stage 1, still open**: new keys and PINs (all were shared in chat), test mode off, test data cleared, real ₹1 payments and the Easebuzz webhook, paid hosting plans, GSTIN and invoice numbers on the bill, Tokyo or Mumbai for the database. Done: kiosk-only ordering, owner PIN, gateway-down fallback, server next to the database.
2. **Stage 2, still open**: tablets locked to the app, an internet fallback for staff, a backup restore drill, end-of-day cash count, a dry run with staff, one-page guides. Done: self-healing screens, System page, phone notifications.
3. **Features picked from `docs/feature-research.md`** (owner to choose): kitchen marks a dish sold out, pause ordering with opening hours, a wait time.
4. **Stage 3, ease of use** (`docs/ui-audit.md` rounds 3 and 4): loud dine-in/takeaway on the chit, bigger kitchen buttons, TV adverts and chime, veg marks, the restaurant's own photos.
5. **Owner to do**: answer the questions at the end of `docs/go-live.md`; delete merged branches on GitHub (about 30); decide on the nine waiting Dependabot updates.

## How things are (decisions worth knowing)

- English only. Full menu prices; a discount only through a code the owner made. Order numbers are plain daily numbers (old "A-042" rows show as "42").
- GST 5% on top, rounded to the nearest rupee and split CGST/SGST: bills have no round-off line.
- Start screen has one "Tap to order"; dine in / takeaway is asked in the cart; the order-number screen asks "Still there?" after 90 s and returns to start 30 s later; an untouched order is cleared after two quiet minutes + a 15 s prompt; "Start over" sits on the menu and the cart and asks first when dishes are chosen; scrolling, typing or a finger moving all count as the customer being there.
- UPI is confirmed by Easebuzz's payment gateway by itself (`docs/payments.md`); if the gateway is down the kiosk offers card and cash only (the shop's printed QR at the counter is the backup). Card and cash wait on the kitchen's "Collect payment" shelf.
- Test mode (off unless `TEST_MODE=1`): cash counts as paid, a ₹1 test item shows.
- Cash at the kiosk is the owner's switch (owner app → Offers → On the kiosk), off by default.
- Two PINs: `STAFF_PIN` for the kitchen and for setting a tablet up as the kiosk, `OWNER_PIN` (six digits) for the owner app. The owner PIN also works wherever the staff PIN does.
- Menu = dishes in `lib/menu.ts` + everything the owner changes from the dashboard (own dishes, sections, extras, notes, hidden, order), merged by `mergeCatalog()`. Sold out lasts for the day.
- Screens poll (no Realtime), pause when hidden, and reload themselves after a deploy.
- Design rule: never flatten an approved design; compare against `main` side by side before pushing visual changes (see `CLAUDE.md`).

## Open questions (owner)

- GST inclusive or exclusive? (v1 adds 5% on top.)
- Tablet model / Android version; receipt printer; shop Wi-Fi reliability.
- The restaurant's own dish photos (current ones are stock photos, `public/food/CREDITS.tsv`).

## Gotchas

- The Claude environment has the live Supabase keys: anything run locally can hit the real DB. For local runs blank them (`NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SECRET_KEY=`); e2e already does and refuses otherwise.
- Local servers: `scripts/serve-local.sh` and `scripts/stop-server.sh` (never `pkill -f next…`: it kills the shell).
- Every branch gets a preview at `https://benne14-git-<branch-with-dashes>-abhinav-mudgal-s-projects.vercel.app`; previews share the production database.
- This session can't delete GitHub branches or run downloaded binaries; database integration tests run only in CI (the `db` job).

- Free-tier Supabase pauses after inactivity; `/api/health` then shows a 521/522. Restore it in the dashboard.
- e2e tests blank the Supabase vars and refuse to run unless the store is `memory`, so they never write to the real DB.
- How to run e2e and compare screens in a Claude session: `CLAUDE.md`, last section.

## Done

- 2026-11-28 — Card and cash wait at the kiosk: after picking one, the customer sees "Pay by card" / "Pay cash" with the amount and no order number; the number and the kitchen's chit come only when staff tap Paid (kitchen screen or owner app). Staff's Cancel sends the customer back to the ways to pay; the customer's cancel, or three minutes of nobody there plus a one-minute prompt, drops the unpaid order. Works because there is one kiosk with the counter beside it.

- 2026-11-28 — Card at the kiosk is the owner's switch and starts off, like cash (migration 0018): out of the box the kiosk takes UPI only. Card still means the customer pays on the Paytm machine at the counter and staff mark it paid; sending the amount to the machine by itself waits on Paytm's keys (`docs/payments.md`).

- 2026-11-28 — Shop screens: the owner picks which device is the shop's kiosk, kitchen tablet and TV (System → Screens); only those are watched for going silent, other phones and laptops sit in a list that can be forgotten (migration 0017). Preview links no longer register as screens. The plain address lists nothing: a device that used a screen before is sent back to it, anyone else sees "Page not found". Each screen installs as its own app (`/kiosk.webmanifest` and so on).

- 2026-11-28 — Wording: "sambar" and "benne 14" everywhere customers and the owner read; plain dish descriptions. The owner can delete a dish they added (from its page or the Hidden list) and a section they added together with its dishes; dishes and sections that came with the app can only be hidden.

- 2026-11-28 — Audit of the two days of launch changes by a second reader: money maths and "never paid without asking Easebuzz" hold. Fixed what it found: a customer mid-order keeps their extras when the owner gives the dish its own list (and is brought back to the cart instead of shown a refusal); a cancelled UPI order's QR is closed at Easebuzz whoever cancels it; a settled InstaCollect payment counts as paid; a new dish is not duplicated when its extras fail to save. Kiosk back buttons use the short chevron.

- 2026-11-28 — Each dish has its own extras and its own "Comes with" line, edited on the dish's page in the owner app (add, price, remove, copy from another dish; ₹0 is a free tick box). The separate Extras page is gone. A dish keeps its section's shared extras until its own list is first edited. The kitchen chit prints a dish's free choices in black. Test data wiped by the owner the evening before (orders, counters, logs).

- 2026-11-27 — GST is kept to the paisa (CGST and SGST 2.5% each) and only the total is rounded to the rupee, with a "Round off" line on the cart, the bill, the owner's order view and both CSVs; what customers pay is unchanged for every amount. "Start over" on the menu and cart. The order ticket no longer promises a time; the QR line says what scanning gives. The shop's logo heads the menu's side bar.

- 2026-11-27 — Kiosk polish for launch: dish photos shown whole on the dish sheet and house special; the shop's logo and a hopping dosa host on the start screen; "Note for the kitchen" removed (Less oil and Extra crisp retired; "Potato stuffing on the side" stays on Masala Dosa as a free tick box); "Still there?" waits two minutes and counts scrolling and typing as activity.

- 2026-11-27 — Ready for real customers: test mode is off unless `TEST_MODE=1` (no red tag on the kiosk, no ₹1 test dish), cash at the kiosk is the owner's switch and starts off (migration 0016), and the menu's side bar lights every section while scrolling, short ones at the end included. InstaCollect proven with a real ₹1 payment and merged (it has its own Wire keys); the live site moves to it when `PAYMENTS=instacollect` is set for Production in Vercel (how to check: `CLAUDE.md`, Vercel settings). Card-machine plan saved in `docs/payments.md`.

- 2026-11-21 — InstaCollect built as a second way of taking UPI (`PAYMENTS=instacollect`, same keys): one call for a QR into the shop's own virtual UPI ID, confirmed by asking Easebuzz, wrong amounts flagged, a cancelled order's QR closed. Built from the docs against a stand-in; **not yet tried on the real Easebuzz**. The gateway stays as it is until real ₹1 payments pass (`docs/payments.md`).
- 2026-11-16 — Owner's report: the owner app sometimes sat on "Loading" with no numbers. A request that never came back (a phone freezes it when the app is put away) left the refresh loop waiting for good. Every polling screen now gives up on a call after 20 seconds and asks again, and wakes on more signals from the phone. Reproduced by a test that fails on the old code.
- 2026-11-16 — The owner can change the photo of the dishes that came with the app (Menu → a dish → Photo: take or choose), and bring the original back. No database update needed.
- 2026-11-16 — The phone bill is a tax invoice: the shop's name, address, GSTIN and FSSAI registration number, a running invoice number given at payment (`B14/26-27/000123`, migration 0015), SAC code, place of supply, the shop's phone, and a refund line. The bills CSV has the invoice number; the owner app shows what is printed on every bill and reminds the owner before the FSSAI fee date. Rules, sources and two questions for the accountant: `docs/tax-invoice.md`.
- 2026-11-16 — Owner's report from the phone: paying by UPI was slow and "Please order at the counter" flashed before the QR. The counter screen no longer shows while an order is on its way, two failed checks within the same five seconds no longer count as an outage, and an order now reads the menu and its other prerequisites from the database together instead of one after another. How slow the real steps are will show on the technical page once migration 0014 is run.
- 2026-11-16 — Tests for what only shows up over time, under load and on phones: one whole shop day checked across every screen and report, a 150-order rush and a long kitchen shift, the owner app and the bill on an Android phone and an iPhone, the 4 am restart, and one night across midnight. No change to the app.
- 2026-11-16 — Technical page in the owner app (System → Technical detail), for whoever looks after the system: how long placing an order, kitchen taps and Easebuzz calls take, errors grouped with a count, payments and orders that are stuck, the database's size, and a "Copy report" button that copies all of it as text to paste into a chat. Needs migration 0014. Everything stays inside the app: no outside service.
- 2026-11-15 — The three biggest files split with no change in behaviour: the browser client (`lib/client/`), the kitchen screen (`app/kitchen/` parts) and the Supabase store (`lib/store/supabase/`, one file per area). Code moved, not rewritten.
- 2026-11-15 — Clean-up: unused helpers and CSS removed, docs corrected (PINs, kiosk key, Easebuzz, the API table), `docs/README.md` lists every doc, pre-build plans moved to `docs/history/`, `scripts/serve-local.sh` and `scripts/stop-server.sh` added, `CLAUDE.md` now holds how to work with the owner and how to run things in a session.
- 2026-11-15 — When Easebuzz does not answer, the kiosk no longer shows the shop's own QR: the UPI order is released and the pay screen offers card and cash, with UPI greyed out for two minutes before it is tried again (owner's call: the printed QR at the counter is the backup). Feature study of TastyIgniter, Petpooja and the kiosk vendors in `docs/feature-research.md`.
- 2026-11-14 — Security locks (`docs/go-live.md` stage 1): orders are accepted only from a tablet staff have set up as the kiosk (staff PIN once, the tablet then holds a signed key; at most 120 orders a minute per tablet), and the owner app takes its own six-digit `OWNER_PIN` (the staff PIN no longer opens it once that is set; the owner PIN still does everything the staff PIN does). The TV and the public order list are unchanged (owner's call).
- 2026-11-14 — Fault tolerance, part 2b: alerts on the owner's phone. The owner app's System page has "Turn on notifications" (per phone, opt-in). A check that runs with the kitchen's and TV's polling (at most once a minute) and from the 15-minute uptime job opens an alert for each new problem and sends one notification per problem: a silent kiosk, kitchen screen or TV, a burst of errors, a payment that needs a look. Needs migration 0013. One new dependency: `web-push`.
- 2026-11-14 — Fault tolerance, part 2a: the owner app has a System page. Every screen says "I'm here" each half minute (`/api/beat`), unhandled errors on screens and on the server are kept in `error_log` (`/api/log`), and the page lists the screens (online or silent), what needs a look (`lib/system.ts`) and the latest errors. One line on Today shows green or red. Needs migration 0012. Phone notifications are part 2b.
- 2026-11-14 — Fault tolerance, part 1 (`docs/go-live.md` stage 2): the kiosk sends customers to the counter while the server or database can't be reached and comes back by itself; no request waits more than 12 s (database calls 8 s); a crashed screen says "One moment" and reloads (never in a loop); screens stay awake, reload at 4 am, and staff can restart one by holding the logo 5 s; the kitchen says across the screen when orders are not arriving and flashes an order nobody started for 3 minutes.
- 2026-11-14 — New dish photos: all ten dishes (filter coffee now has one too) use large, clear stock photos from Pexels and Unsplash, 1400×1400, chosen to match each dish. Sources in `public/food/CREDITS.tsv`. The kiosk start screen, menu, dish sheet, TV banner, kitchen tray and reports all use them.
- 2026-11-14 — Audit of the owner menu across every screen (`docs/menu-audit.md`): seven gaps fixed (dish sheet crash when an extra is switched off mid-order, suggestions and TV banner ignoring owner-made dishes and sections, start-screen photos of hidden dishes, kitchen colours and tray order). The Menu tab's three buttons became one "Add or change" button.
- 2026-11-14 — Owner menu, stage 3 of 3: extras and kitchen notes. Add an extra to a set, rename and reprice any extra, switch extras off, make a new set of extras, choose which set any dish offers, add kitchen notes (more / less / plain, per section) and switch notes off. The kitchen chit colours the owner's own extras and notes. Needs migration 0011. Extras and notes are switched off, never deleted, so old chits and bills still read right.
- 2026-11-14 — Owner menu, stage 2 of 3: sections. Add a section, rename any section, drag sections into a new order, switch a whole section (and its dishes) off the kiosk, remove an empty section the owner added. A dish the owner adds can go in any section. Needs migration 0010. The kiosk no longer breaks if the house special is hidden. Extras and kitchen notes are stage 3.
- 2026-11-14 — Owner can change the menu's dishes from the dashboard (stage 1 of 3): add a dish with a photo from the phone, keep it as a draft, check how the kiosk will show it, publish; hide any dish and bring it back; drag dishes into a new order. Needs migration 0009 (also creates the photo bucket). Sections and extras are stages 2 and 3.
- 2026-11-14 — Kitchen ticks: a tap on a chit line counts one more of that dish as given ("2 of 4 given", then a green tick), a hold takes one back. Saved on the server (migration 0008) so every kitchen screen agrees and a reload keeps them. Ready lights up when everything is out; the bottom tray counts only what is still to be made. The TV does not show ticks.
- 2026-11-14 — Owner can delete a discount code (asks twice; past orders keep their discount). Kitchen "Today's orders": a tap on a row opens the whole order, one dish per line with extras and notes. Kitchen screen uses the full width of a wide monitor instead of leaving bars left and right.
- 2026-11-14 — Easebuzz went live on production. The UPI screen no longer counts down: the kiosk waits for the payment, asks "Still there?" after four quiet minutes, and a customer who walks off and pays later still gets the order (the kitchen screen's polling re-checks open payments).

- 2026-11-14 — Automatic UPI confirmation through Easebuzz (the shop's own gateway account), built and off by default: the kiosk shows Easebuzz's payment page, the order goes to the kitchen by itself once Easebuzz confirms, with fallbacks. Tried end to end on Easebuzz's sandbox. Steps to switch on: `docs/payments.md`.

- 2026-11-14 — Accuracy audit, database safeguards (migration 0006): bills must add up, saved bills can't be edited, only allowed status moves, every change of state logged and shown on the order, no skipped numbers on a double submit.

- 2026-11-14 — Accuracy audit (`docs/accuracy-audit.md`), first fixes: a changed cart can no longer be saved as the old order, paid orders can't be cancelled (refund only), the total shown must be the total charged, one rule for takings on every screen, integer money maths, and reports cross-checked against the CSVs by tests.
- 2026-11-14 — Owner's notes: price changes reach the TV banner and an open kiosk within 30 s; cart suggestions depend on the order and on best sellers; kitchen timers say "min"; round chevron buttons replace the long arrows; three sub-lines removed.

- 2026-11-14 — Discount codes and phone numbers: owner makes % or ₹ codes in a new Offers tab (minimum order, cap, last day, on/off); the kiosk cart takes a code (off before GST) and an optional phone number for offers; two owner switches hide either box; customer list with CSV. Phone numbers never ride along with an order to the TV or the bill.


- 2026-11-13 — UI round 1 (`docs/ui-audit.md`): prices say "+ 5% GST", one GST line in the cart, calmer order-number screen, honest pay-screen wording, and timers instead of a Start over button ("Still there?" after 60 s mid-order and 90 s after an order).
- 2026-11-13 — Code upkeep (audit D): kiosk and dashboard split per screen, menu state via context, ESLint + Prettier in CI, Supabase store tested on a real Postgres in CI, migration log, docs rewritten, Dependabot.

- 2026-11-13 — Audit (`docs/audit.md`) and fixes for reliability and ease of use: TV shows every ready order as scaled tickets, busy kitchen rail, auto-reload, orders past midnight, lighter polling, atomic menu edits, uptime check, wording, readable text, app icons.

- 2026-11-13 — Owner dashboard v1 (`/admin`): today vs yesterday, needs-you payments, orders with paid/cancel/refund, menu sold-out (back on next morning) + price/name/description/extras, reports (day/week/month/custom, dishes, busy hours, GST) + CSV, change history. Menu changes stored as overrides on the menu in code.

- 2026-11-13 — Hardening: 111 unit/DB tests (incl. real migrations in PGlite), 32 browser tests incl. API abuse and network failures, read-only smoke checks after each Vercel deploy. Fixed 500s on bad input, PIN guessing, stale-tablet undo, endless bill loading. See `docs/testing.md`.

- 2026-11-12 — Second owner round: no discount (full prices), podi spice removed, options/notes renamed, clearer ₹, thank-you line matches the order, dine in/takeaway moved to the cart, 2-minute return to start, kitchen shelf shrinks to fit.

- 2026-11-12 — Owner feedback round: English only, no 14% sticker on the start screen, ₹ drawn by the brand fonts, green +/red − tags on kitchen chits, today's history on kitchen and board, plain order numbers, no round-off on bills, start screen returns 15 s after the order number.

- 2026-11-12 — Test mode (default on): cash counts as paid, ₹1 payment test item, kiosk ribbon.
- 2026-11-12 — Real UPI to the shop's Paytm ("I've paid" + counter confirm on the payment shelf); kitchen PIN checked when typed.
- 2026-11-10 — v1 live on the preview with Supabase; fixed kitchen cards jumping after a tap, hydration warning, friendly kiosk errors; e2e locked to the memory store.
- 2026-10-25 — v1 slice: Next.js 15 app (kiosk, kitchen, board, phone bill), server-side pricing with GST, idempotent orders with daily tokens, staff PIN, 15 unit + 3 e2e tests, CI.
- 2026-10-25 — Light theme for all prototype screens; build plan + CLAUDE.md.
- 2026-10 — Design prototype (kiosk, kitchen, TV board) and Hindi-voiced walkthrough video.
