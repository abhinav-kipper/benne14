# Go-live plan — Benne 14

Written 2026-11-14 from `docs/state.md` and the three audits. What stands between the app as it is and a system the shop can run on every day. Tick items as they are done.

Where things stand: every screen works end to end, UPI confirms by itself through Easebuzz, the owner controls the whole menu. It has **not** served a real customer: test mode is on, and the items in stage 1 are open.

## Stage 1 — Before the first real customer

Safety and money. None of this is visible to customers, all of it matters.

- [x] **Only the kiosk can place orders** (2026-11-14: staff PIN once per tablet, then a signed key; 120 orders a minute at most). Today anyone who knows the web address can send orders to the kitchen. Fix: a key that only the shop's tablet holds, plus a limit on orders per minute. (`docs/audit.md` A1)
- [ ] **Today's orders are not public** (owner on 2026-11-14: leave for now). The list of orders (names, items, totals) can be read without a PIN, and with an order's id an unpaid UPI order can be cancelled. Fix: PIN for the full list; the TV gets numbers only. (A2)
- [x] **A separate owner PIN** (2026-11-14: `OWNER_PIN`, six digits; still to set in Vercel). One 4-digit PIN opens both the kitchen and the takings, prices and menu. Fix: a second, longer PIN for the owner app. (A3)
- [ ] **New keys and PINs.** The staff PIN, the Supabase secret key and the Easebuzz key and salt were all pasted in chat. Change all of them before launch. Changing the Easebuzz pair also stops the old kiosk, so do it on the switch-over day. (owner + me)
- [x] **Test mode off** by default since 2026-11-27 (on only with `TEST_MODE=1`): check Vercel has no `TEST_MODE=1` for Production. (A8)
- [ ] **Clean books.** Remove the test orders and test dishes, sections and extras made while trying things, so day one's report starts at zero. (`docs/accuracy-audit.md` A5)
- [ ] **Payments proven with real money.** Set the Easebuzz webhook address; pay ₹1 from GPay, PhonePe and Paytm; refund one; confirm the money and the settlement show in the Easebuzz dashboard. (owner)
- [x] **What happens when the gateway is down** (2026-11-15): the kiosk offers card and cash only; no QR from the app on that path, so nothing is taken on trust. The shop's printed QR at the counter is the backup.
- [x] **Server next to the database** (Tokyo, `vercel.json`, 2026-11-14). Still open: move both to Mumbai before launch? The server runs in the USA and the database elsewhere, so every tap waits about a second. The database is in Tokyo (`ap-northeast-1`). What costs time is the server talking to the database (three or four times per order), not the customer talking to the server, so the server belongs next to the database: Tokyo (`hnd1`) now, a one-line change. Best for Delhi in the long run is both in Mumbai, which means moving the database to a new Supabase project in `ap-south-1`: easiest before launch, while there is no real data. (A6)
- [ ] **Paid hosting plans** (owner agreed on 2026-11-14 to upgrade both). Vercel's free plan does not allow commercial use and has request limits; Supabase's free plan pauses the database when idle and keeps no backups. Both need the paid plan (about US$20 and US$25 a month). (A7, owner)
- [x] **A proper tax bill** (2026-11-16): GSTIN, FSSAI number, shop address and a running invoice number on the phone bill (`docs/tax-invoice.md`). Still needed from the accountant: regular or composition scheme, and whether the legal name must be printed. (accuracy C1, ui U10)

## Stage 2 — So a normal day cannot break it

- [x] **Screens look after themselves** (2026-11-14): stay awake, reload at 4 am, recover from a crash by themselves, restart by holding the logo 5 s; the kiosk sends customers to the counter when it can't reach the server; the kitchen says so loudly when orders are not arriving and flashes an unstarted order.
- [ ] **The tablets behave like appliances.** Kiosk tablet locked to the app (Android screen pinning or a kiosk browser), screen never sleeps, always on charge, restarts into the app. Same for the kitchen tablet and the TV. (audit B5)
- [ ] **When the internet drops.** Today the screens say they are offline and recover by themselves, but no order can be placed. Decide the fallback: a phone hotspot as second Wi-Fi, and a paper pad at the counter. Write it on one page for staff.
- [x] **The owner can see what is wrong** (2026-11-14): System page in the owner app with every screen's status, what needs a look, and the latest errors.
- [x] **Whoever fixes it can see why** (2026-11-16): a technical page behind the System page with step timings, grouped errors, stuck payments, database size, and a report to copy into a chat.
- [x] **Someone is told when something fails** (2026-11-14): notifications from the owner app to every phone that switched them on, on top of the GitHub email every 15 minutes. Still to do on the real phones: switch it on, send a test. Error and uptime alerts exist; decide whose phone they reach and test one.
- [ ] **Backups and a restore drill.** With the paid Supabase plan, restore yesterday's backup once into a spare project to know it works.
- [ ] **End of day.** A closing screen: takings by UPI, card and cash, a box to type the cash counted, the difference. (accuracy C5)
- [ ] **A dry run.** One quiet afternoon with staff ordering as customers on the real tablet, TV and kitchen screen, paying real ₹1 orders, before the first real customer.
- [ ] **One-page guides**: for the cook (chits, ticks, ready), the counter (cash, card, refunds) and the owner (menu, sold out, reports).

## Stage 3 — Easier to work with

- [ ] Kitchen chit says DINE IN or TAKEAWAY loudly, not with a small grey icon. (ui U19)
- [ ] Bigger kitchen buttons for wet or gloved hands. (U20)
- [ ] The TV shows dishes and prices when no order is ready, and chimes when one is. (U21, U22)
- [ ] Veg mark and a "bestseller" cue on the kiosk. (U9)
- [ ] The name box on the kiosk is not covered by the keyboard: check on the tablet. (U6)
- [ ] Bigger tap targets in the owner app. (U23)
- [ ] Owner can change the section of the ten original dishes, not only of dishes they added. (Their photo: done 2026-11-16.)
- [ ] The restaurant's own photos, one shoot, same plate and light. (U8)
- [ ] Printed kitchen chit or customer receipt, if the shop wants paper (needs a printer choice).

## Stage 4 — When it grows

- [ ] Reports worked out in the database instead of loading every order (slow after about a year). (audit D7)
- [ ] Refunds sent through Easebuzz from the owner app instead of recorded by hand.
- [ ] A second outlet (nothing in the data says which shop an order belongs to). (D8)
- [ ] Offers sent to the phone numbers customers left (WhatsApp or SMS), with an opt-out.
- [ ] Live updates instead of asking the server every few seconds, if the request count becomes a cost.

## Needed from the owner

1. ~~The Supabase project's region~~ Tokyo, `ap-northeast-1` (answered 2026-11-14). Open: move the database to Mumbai before launch, or keep Tokyo?
2. GSTIN, FSSAI number, shop address; whether prices include GST.
3. ~~Go-ahead for the paid Vercel and Supabase plans~~ Yes (2026-11-14); upgrade both before launch.
4. Tablet model and Android version; whether a receipt printer is wanted.
5. Opening hours (the charts assume 8 am to 11 pm).
6. A launch date to work back from.
