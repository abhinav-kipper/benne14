# Owner menu audit (after stages 1 to 3)

What was checked on 2026-11-14 after the owner got full control of dishes, sections, extras and kitchen notes: every screen that reads the menu, for places where an owner's change could break something or simply not show up. Tick items as they merge.

## Found and fixed

- [x] **Kiosk dish sheet could crash.** If the owner switched off an extra or a note while a customer had the dish's sheet open with it picked, the price could not be worked out. The sheet now only counts what the dish still offers. (`app/kiosk/screens/ItemSheet.tsx`)
- [x] **Cart suggestions ignored the owner's sections.** "Anything else?" only ever offered drinks, idli/vada and dosas, so a dish in "Sweets" was never suggested. Owner-made sections are now offered after the usual three. (`lib/suggest.ts`)
- [x] **Start screen showed photos of hidden dishes** and never the owner's own photos. The nine photos now come from what is on the menu; a hidden dish's place goes to another dish with a photo. (`app/kiosk/screens/Home.tsx`)
- [x] **TV banner never advertised a dish the owner added.** Owner-made dishes with a photo now join the rotation (up to three). (`app/board/Board.tsx`)
- [x] **Kitchen chit could show a brand-new extra or note without its colour for up to a minute.** The kitchen now fetches the menu again the moment a chit shows something it has not heard of. (`app/kitchen/Kitchen.tsx`)
- [x] **Kitchen tray grouped dishes by an internal id**, so owner-made sections landed in an arbitrary place. It now follows the menu's own order of sections.
- [x] **Kiosk menu could show an empty section** when the only dish left in a section was the house special (which sits in the big banner). Such a section is no longer listed.
- [x] Fixed in the stage PRs themselves: a hidden dish in a cart or open in the sheet, a hidden house special, a hidden filter coffee ("Goes well with"), a hidden TV promo dish.

## Checked, nothing to fix

- Server pricing: always from the merged menu; hidden dishes, drafts, dishes in a hidden section, switched-off extras and notes are refused (tests in `tests/unit/catalog.test.ts`, `tests/e2e/admin.spec.ts`).
- Bills, the phone bill page, order history, refunds, reports and CSVs: read the order's own copy of names and prices, so no menu change alters them.
- Reports' top dishes: show owner-made dishes with their photo.
- Best sellers (`/api/popular`): ids of dishes no longer on the menu are ignored by the suggestions.
- Discount codes, phone numbers, payments, order numbers: do not read the menu's layout.
- The ₹1 payment test dish and its section: never in the owner's lists, cannot be hidden, moved or edited.

## Known limits (by design, not bugs)

- Dishes that came with the app stay in their own section; only owner-made dishes can be put in an owner-made section.
- The words of a kitchen note cannot be edited after adding it: switch it off and add a new one.
- The sugar choice on drinks is fixed.
- A dish offers one set of extras (or none), not several.
- An open kiosk learns of a menu change within half a minute, the kitchen within a minute (or at once when a chit needs it).
