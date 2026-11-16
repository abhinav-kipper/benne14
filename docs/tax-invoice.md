# The bill as a tax invoice — what Indian rules ask for, and where each thing is

Written 2026-11-16 from the shop's GSTIN, its FSSAI registration certificate and phone number, and a
reading of the rules below. **This is not legal advice.** The sources are listed at the end; most are
practitioner summaries of the rules, not the Gazette text. Two questions at the bottom need the
accountant before launch.

## The shop's details (in `lib/shop.ts`)

| What | Value | From |
|---|---|---|
| Trade name | Benne 14 | FSSAI certificate |
| Address | Ground Floor, Shop No. 1, Plot No. 15, Shakti Khand 3, Indirapuram, Ghaziabad, Uttar Pradesh 201014 | FSSAI certificate |
| GSTIN | 09HQSPM1340E1ZM (state code 09 = Uttar Pradesh; check character verified by a test) | owner |
| FSSAI registration no. | 22726105001944 (a registration, not a licence; fee paid up to 17 Aug 2027) | FSSAI certificate |
| Phone | 74286 71414 | owner |
| Service | Restaurant service, SAC heading 9963, 5% GST (2.5% CGST + 2.5% SGST), no input tax credit | rate notification, as summarised by the sources |

## What a tax invoice must carry (CGST Rule 46) and where it is on our bill

| Rule 46 asks for | On the phone bill (`/r/<id>`) |
|---|---|
| (a) Supplier's name, address, GSTIN | "From" block at the top of the bill |
| (b) A consecutive serial number, at most 16 characters (letters, digits, `-`, `/`), unique in a financial year | `B14/26-27/000123`, given by the database when the order is paid (migration 0015). Never changed, never reused; an unpaid or cancelled order never gets one, so there are no gaps |
| (c) Date of issue | next to the invoice number (the day of payment) |
| (d)–(f) Customer's name and address | Not needed: only for a registered buyer, for a bill of ₹50,000 or more, or when the customer asks. **Not built** (see "Not done") |
| (g) HSN / SAC code | "SAC 9963" under the totals. The sources say it is optional on bills to consumers for a business under ₹5 crore turnover; it is shown anyway |
| (h) Description, (i) quantity | each dish with extras, quantity and rate |
| (j) Total value, (k) taxable value after discount | "Item total", "Discount", "Taxable value" |
| (l) Rate and (m) amount of each tax | "CGST @ 2.5%", "SGST @ 2.5%" with amounts |
| (n) Place of supply | "Place of supply: Uttar Pradesh (09)" |
| (q) Signature | Not needed on an invoice issued electronically (proviso to Rule 46); the bill says "computer-generated invoice" |
| (r), (s) E-invoice QR and declaration | Do not apply: e-invoicing is for business-to-business invoices of larger businesses |

Also on the bill: the **FSSAI number** (FSSAI's order makes the 14-digit licence or registration
number compulsory on every bill, cash memo and receipt of a food business), the shop's **phone
number** for questions, and a **refund line** when a paid order was refunded.

Before an order is paid the page is titled "Bill" and has no invoice number; it becomes "Tax
invoice" by itself once payment is confirmed.

## Where else the details appear

- **Bills CSV** for the accountant: a new "Invoice" column.
- **Owner app → System → "On every bill"**: the name, address, GSTIN, FSSAI number and phone as
  printed, so the owner can check them.
- **Owner app → System**: a reminder from 30 days before the FSSAI fee date, and a red line once it
  has passed (the registration is suspended if the yearly fee is not paid).
- **Not on the kiosk or TV.** The FSSAI number has to be on the bill and on the board displayed at
  the premises; a screen is not asked for. Adding a line to the kiosk's start screen is the owner's
  call (it changes an approved design).

## Not done, on purpose

- **A customer's own GSTIN on the bill** (a company buying lunch and wanting credit). Rare at a dosa
  counter; needs a box on the kiosk. Say if it is wanted.
- **Credit notes for refunds.** The app records a refund against the invoice and shows it on the
  bill and in the CSV. Whether the accountant wants a numbered credit note for each (GST section 34)
  is `docs/accuracy-audit.md` C2.
- **A printed bill.** Needs the printer (see the note on printing in `docs/state.md`).
- **Old orders** made before migration 0015 have no invoice number. They are test orders and are to
  be cleared before launch.

## Two questions for the accountant before launch

1. **Regular scheme or composition scheme?** The app charges 5% GST on top of menu prices and prints
   a tax invoice, which is right for the regular scheme. A composition dealer may not charge GST to
   the customer at all and issues a "bill of supply" that says "composition taxable person, not
   eligible to collect tax on supplies". If the shop is on composition, the bill and the prices must
   change before the first real customer.
2. **Whose name is the supplier's name?** The GSTIN belongs to a proprietor (its fourth-from-PAN
   letter says an individual). The bill shows the trade name "Benne 14". If the accountant wants the
   legal name as on the GST certificate printed too, send it and it goes in `lib/shop.ts`.

## Sources

- Rule 46, CGST Rules (text as reproduced): https://www.taxheal.com/rule-46-cgst-rules-2017.html
- Rule 46 mandatory fields: https://cleartax.in/s/gst-invoice-details ·
  https://www.gimbooks.com/blog/gst-invoice-mandatory-fields-rule-46-checklist/
- Section 34 (credit notes), CBIC: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section34_v1.00.html
- Restaurant service, SAC 9963, 5% without ITC: https://busy.in/sac-code-996331/ ·
  https://www.incorpx.io/sac-codes/code-996331
- Composition scheme for restaurants: https://busy.in/gst/taxability-of-restaurants-under-gst-composition-scheme/
- FSSAI order on the number on bills: https://mail.fssai.gov.in/upload/advisories/2021/10/6156936ac80bbOrder_License_Number_Print_01_10_2021.pdf ·
  https://tallysolutions.com/accounting/fssai-registration-number-on-invoices-mandatory-from-1st-january-2022
