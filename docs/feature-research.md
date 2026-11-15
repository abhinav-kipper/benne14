# Feature research — what other restaurant systems do that we don't

Written 2026-11-15. A study of TastyIgniter (which the owner asked about) and three kinds of system closer to what Benne 14 is: an Indian restaurant POS with a kiosk (Petpooja), and the big kiosk vendors (Toast, Square, Bite, GRUBBRR). The question: is anything important missing here, and what is worth copying?

Sources are the vendors' own pages and a few reviews (listed at the end). Vendor numbers such as "+28% average order" are their marketing and are not repeated as fact.

## What TastyIgniter is

A free, self-hosted **online ordering website** for restaurants: customers order delivery or pickup from home on the restaurant's own site instead of through Zomato or Swiggy. It is built on PHP/Laravel, with paid add-ons (loyalty, table ordering, printing, each about US$30 to US$50 a year).

It is a different kind of product from ours. It has **no kiosk mode, no UPI, no GST handling, and no TV order board**. Its kitchen display is a free add-on that moves whole orders between columns; it has no per-dish ticking. Its strengths are everything around ordering from home: delivery zones, table reservations, customer accounts, reviews, scheduled menus, multi-branch.

So it is not a replacement and not a base to move to. It is useful as a checklist of what a mature ordering product has.

## Where we already match or do better

| Area | TastyIgniter | Petpooja kiosk + KDS | Benne 14 |
| --- | --- | --- | --- |
| Self-order kiosk | No | Yes | Yes |
| UPI confirmed automatically | No (Stripe, PayPal, Square…) | Yes | Yes (Easebuzz) |
| GST on the bill | Add-on, German VAT only | Yes | Yes |
| Kitchen screen | Order-level columns | Stations, mark ready, item totals | Chits, **per-dish ticks**, item totals on the tray |
| TV order board | No | Yes (token display) | Yes |
| Owner changes menu from phone | Admin site | Through the POS | Yes: dishes, sections, extras, notes, photos |
| Discount codes | Yes | Yes | Yes |
| Bill on the customer's phone, with live status | Order status page | Not stated | Yes (QR on the order-number screen) |
| Screens that recover by themselves, alerts to the owner | Not stated | "Offline architecture", no detail | Yes |
| Orders only from the shop's own tablet | Not applicable | Yes (their hardware) | Yes (kiosk key) |

## What they have that we don't

Ranked by how much it would matter at a single dosa counter, not by how impressive it sounds.

### Worth doing soon (small, clear value)

1. **Kitchen can mark a dish sold out.** In Petpooja the cook marks an item out of stock on the kitchen screen and it disappears from ordering. Here only the owner app can do it, and the owner is often not the one who sees the batter run out. *Idea:* a "Sold out" switch per dish on the kitchen screen, same effect as the owner's switch (back on tomorrow).
2. **Pause ordering.** Every kiosk system lets staff stop taking orders: a rush the kitchen can't absorb, a gas cylinder change, closing time. Here the kiosk only stops when the internet does. *Idea:* a "Pause the kiosk" switch on the kitchen screen and owner app; the kiosk shows the "Please order at the counter" screen we already have. With it, **opening hours**: the kiosk closes itself at night.
3. **A wait time.** TastyIgniter quotes a ready time from the kitchen's current load; Toast and Square do the same. Here the customer gets a number and no idea whether it is 4 minutes or 20. *Idea:* "About 8 minutes" on the order-number screen and the TV, worked out from how long recent orders took and how many are ahead.
4. **Dishes on a schedule.** TastyIgniter's "mealtimes": breakfast items stop at 11, a Sunday special appears on Sundays, automatically. Here a dish is on or off by hand. *Idea:* optional "available from / to" and days on a dish.
5. **Packing charge for takeaway.** TastyIgniter has a bag-charge add-on; in India a small packing charge on takeaway is common. Here dine-in and takeaway cost the same. *Only if the shop charges one.*

### Worth deciding on (bigger, real value)

6. **Printed kitchen chit or customer receipt.** Both TastyIgniter and Petpooja print a ticket the moment an order lands. Here everything is on screens. A printer is the usual backup when a kitchen tablet dies, and some customers expect paper. *Needs:* a printer choice (a network thermal printer), then a small build.
7. **Order from your own phone.** TastyIgniter's whole product, and its "table ordering" add-on: scan a QR at the shop, order and pay on your phone, skip the kiosk queue. One kiosk is a queue at lunch; phones remove it. *Cost:* the "only the shop's kiosk can order" lock would need a second, safe way in (a QR that changes, or pay-first only).
8. **Loyalty for repeat customers.** TastyIgniter and Petpooja both sell points/wallet add-ons. We already collect phone numbers with consent. *Idea:* "your 6th dosa is on us" tracked by phone number, or simply a code sent to returning customers.
9. **Combos.** Kiosk vendors push "make it a meal". We have "Goes well with" and suggestions in the cart, but no fixed-price combo (dosa + coffee for ₹249). *Idea:* a combo as its own kind of dish.
10. **Kitchen stations.** Petpooja routes dishes to stations (tawa, drinks). With one or two cooks a single screen is right; with a separate coffee counter, a second kitchen screen filtered to drinks would help.
11. **Feedback after eating.** TastyIgniter collects a verified review after each order. *Idea:* thumbs up/down and one line on the phone bill page, shown to the owner.

### Not for us, or not yet

- **Delivery zones, reservations, customer accounts, newsletter, SEO**: for ordering from home. Benne 14 is a walk-in counter.
- **Tipping**: not customary at an Indian QSR counter.
- **Many languages**: the owner chose English only.
- **Offline ordering** (Petpooja claims it): taking orders with no internet means taking payments that can't be checked. Our fallback is the counter, which is safer.
- **AI upsell** (Bite): our suggestions already follow the shop's own best sellers; more than that needs far more orders than one outlet has.
- **Multi-branch, staff accounts with roles, several GST rates, menu import/export, an API for other tools**: real needs for a chain, already noted for "when it grows" in `docs/go-live.md`.

## Recommendation

Three small ones first, because each removes a moment where staff currently have no button to press: **kitchen marks sold out**, **pause ordering with opening hours**, and **a wait time**. Then decide on the printer, since it also serves as the kitchen's backup.

## Sources

- TastyIgniter: [home](https://tastyigniter.com/), [features](https://tastyigniter.com/features), [marketplace](https://tastyigniter.com/marketplace), [kitchen display docs](https://tastyigniter.com/docs/extensions/kitchendisplay), [Capterra reviews](https://www.capterra.com/p/185818/TastyIgniter/)
- Petpooja: [self-service kiosk](https://www.petpooja.com/poss/self-service-kiosk), [kitchen display](https://www.petpooja.com/kds), [token management](https://www.petpooja.com/online-order-token-management)
- Kiosk vendors compared: [Otter](https://tryotter.com/blog/toolkit/best-self-ordering-restaurant-kiosk-systems), [Fit Small Business](https://fitsmallbusiness.com/best-self-service-kiosk/), [Rezku](https://rezku.com/blog/best-self-service-kiosk)
- Kitchen capacity and order throttling: [QSR Automations](https://qsrautomations.com/blog/guest-management/capacity-management-meltdowns/), [SeenLabs](https://seenlabs.com/blog/when-kiosks-create-bottlenecks-balancing-order-intake-with-kitchen-capacity), [Owner.com help](https://help.owner.com/en/articles/15083053-how-do-i-limit-how-many-orders-my-kitchen-accepts-at-once)

Not reached: Toast's own kiosk page refused the request, so what is said about Toast comes from the review sites above.
