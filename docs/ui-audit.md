# UI and customer-flow audit

Date: 2026-11-13, on `main` at `2cbcf23`. Method: walked the kiosk as a customer (two dishes, UPI),
looked at every screen as a designer, and measured tap targets and text sizes in the browser at the
design sizes (kiosk 800×1280, kitchen 1280×800, TV 1920×1080, phone 390 wide). Yardsticks: common touch
guidelines (Material 48 dp, Apple 44 pt; kiosks usually go larger), WCAG contrast, and what good
self-order kiosks and food apps do. Nothing was changed. Security, speed and hosting are in `docs/audit.md`.

Legend: `[ ]` open · `[x]` done · `[-]` decided not to do. Tick items as they merge.

Measured: **10 taps** from the start screen to the QR for two dishes; **11** to the order number.

## 1. Customer flow: things a customer trips on

- [x] U1 **Price surprise.** The menu says ₹209; after adding one dish with extra benne (₹234) the bar says ₹246 with no explanation. GST first appears in the cart. Fix: say "+ 5% GST" where prices are shown and "incl. GST" on the bar, or make menu prices GST-inclusive (owner's decision).
- [x] U2 **No way to cancel or start over** on the menu or cart. A customer who walks away leaves their cart for the next person for up to 90 s (75 s idle + 15 s prompt). Fix: a visible "Start over" on menu and cart; shorter idle while the cart is untouched.
- [-] U3 (owner 2026-11-13: leave the cart's Edit link as is) **"Edit" in the cart is 25×18 px**, about a third of the minimum touch size, and there is no remove button (only − down to zero). Fix: a proper Edit button and a Remove.
- [x] U4 **Every + opens the full sheet**, even for a dish the customer wants as it comes. Fix: + adds one straight away and turns into the − 1 + stepper; tapping the dish opens the sheet to customise. Saves a tap per dish.
- [x] U5 **Order-number screen is crowded and reads like an error.** The status pill is orange-red for a normal state ("being checked at the counter"), the ticket shouts "SHOW UPI SCREEN IF ASKED", and seven blocks compete. Fix: number first, one calm line about what happens next, tracker and phone QR below; neutral colour for normal states.
- [ ] U6 **Name field sits in the lower third** of the cart; the Android keyboard will likely cover it. Check on the tablet; if so, move the field up or ask the name in its own small step.
- [x] U7 **False promise on the pay screen** ("the money comes back to you automatically"). Same as `docs/audit.md` A4.

## 2. What customers expect to see and don't

- [ ] U8 **Photos are mismatched** (different angles, light, plates; filter coffee has none). This is the single biggest lift available: one shoot, same angle, same light, same plate, for all ten dishes.
- [ ] U9 **No veg mark** (the green dot every Indian menu carries), no "bestseller" cue, no allergen note (dairy, nuts).
- [ ] U10 **The phone bill is not a full tax invoice**: no GSTIN, FSSAI licence number, shop address or invoice number. Owner to supply the numbers; then add them to the bill.
- [x] U11 **Upsell copy is fixed**: "Goes well with your dosa" shows even for an idli-only order.

## 3. Feel: what makes good apps feel finished

- [ ] U12 **Taps barely respond.** Few buttons have a pressed state, adding a dish gives no confirmation (no bump of the cart bar, no "added"), and screens swap with a plain fade. Fix: pressed states everywhere, a small motion when something is added, sheet and screen transitions with direction.
- [ ] U13 **The menu wastes its first screen.** The left rail takes 21% of the width and is two-thirds empty with three sections; the special takes 440 px. Only three dishes show before scrolling. Fix: slimmer rail or top tabs, shorter special, so four or five dishes show.
- [ ] U14 **Small text on the kiosk.** Eleven different places use 11–15 px (section labels, "Optional", "View order", helper lines). At arm's length the floor should be 16 px.
- [x] U15 **Cart bill is accountant-speak.** "CGST 2.5% / SGST 2.5%" as two lines; customers need "GST 5% ₹15" (the split belongs on the bill). The label "Eating" after choosing dine-in is odd.
- [ ] U16 **Start screen is a still poster.** No motion to catch the eye from the queue, no hint of prices or bestsellers.
- [ ] U17 **UPI screen repeats itself**: the headline, the line under it and three step boxes all say "scan and pay".
- [ ] U18 **No design scale written down.** Colours are tokens, but type sizes (11, 12, 13, 14, 15, 16, 17, 18…), corner radii (6–28) and spacing are picked per screen. Fix: a short scale for type, spacing, radius, shadow and motion in `app/globals.css`, used everywhere.

## 4. Kitchen, TV, dashboard

- [ ] U19 **Kitchen: dine-in vs takeaway is a 24 px grey icon**, yet it decides plate or parcel. Make it loud (a word and a coloured band on the chit).
- [ ] U20 **Kitchen: top-bar buttons are 44 px tall** and payment buttons 54 px, for hands that may be wet or gloved. Raise to 56 px or more.
- [ ] U21 **TV when quiet is an empty cream wall** with one grey sentence, and the right half is blank. It is the shop's best advertising space: show dishes and prices while nothing is ready.
- [ ] U22 **TV: no sound when an order is ready** and no wait estimate; "On the tawa" also lists orders the kitchen hasn't started.
- [ ] U23 **Dashboard tap targets are small for a phone**: switches 52×32, "All orders →" and "Reports →" 16 px tall, period arrows 40 px, most text 12–13 px.
- [ ] U24 **Dashboard looks more generic** than the rest (tiles and switch rows). Owner declined a restyle on 2026-11-13; listed for completeness.

## What is already good (keep)

Strong, consistent identity (condensed headline type, cream and butter-yellow, paper chits, tickets, torn slips);
big clear primary buttons at the bottom of every kiosk screen; the amount to pay is unmissable; the order
number is unmissable; sold-out and offline states are handled; the kitchen rail reads at a glance; the bill is clear.

## Suggested rounds

1. **Flow fixes** (U1–U5, U7, U11, U15): no new assets needed, biggest effect on customers.
2. **Feel** (U12–U14, U16–U18): pressed states, motion, menu layout, type floor, design scale. Mockups first.
3. **Needs the owner** (U8–U10, U6 check on the tablet): photo shoot, veg marks, invoice numbers.
4. **Staff screens** (U19–U23).

## Decisions log

(date · item · decision)

2026-11-13 · round 1, owner's choices:
- U1: keep prices; say "Prices + 5% GST" where the menu starts and "incl. GST" on the cart bar.
- U2: (changed the same day, see below) ~~"Start over" on menu and cart~~.
- U3: leave Edit as is. U4: one-tap add (+ adds the dish as it comes; tapping the dish opens the sheet).
- U5: calm the order-number screen, keep everything: neutral status pill, the ticket stub carries a fact (amount) not an instruction.
- U7: "Payment stuck? Ask at the counter." U15: one "GST 5%" line in the cart. U11 + label: upsell line fits the order; "Dine in or takeaway?" stays as the label.

2026-11-13 · round 1, owner's second look:
- U4 follow-up: with one-tap add, nothing said extras and notes exist. Every dish that has them now carries a "Customise" link under its + (the special too). Customising a dish already in the order changes that one instead of adding a second.
- U2: no "Start over" buttons. The kiosk clears itself: "Still there?" after 60 s without a touch (was 75 s), start screen 15 s later.
- Order-number screen: stays 100 s so the bill can be scanned, then asks "Still there?" in place (the number and the bill code stay in view) and clears after 20 s. "I need more time" gives another minute; "New order" is always there. The running countdown bar is gone.
