# Payments — where we are and what's next

Last updated 2026-11-14. Read this before any payments work.

## Live today (no third party involved)

| Method | How it works | Confirmation |
|---|---|---|
| **UPI** | Kiosk shows a per-order QR to the shop's own Paytm UPI ID `paytm.s3zpul3@pty`, payee name "Benne 14", exact amount, note "Benne 14 A-042" (`lib/payments.ts`, `lib/shop.ts`). Money lands straight in the owner's Paytm, same as the standee. | Customer taps **"I've paid"** → order waits on the kitchen's **पैसे लेने हैं** shelf ("UPI · साउंडबॉक्स सुनें") → staff hear the soundbox and tap **पैसे मिल गए**. Unclaimed QRs also show there for 15 min ("QR खुला है"); **रद्द** clears abandoned ones. |
| **Card** | Owner's Paytm Android card machine (screen + printer + tap), used standalone: staff key in the amount. | Staff tap **पैसे मिल गए**. |
| **Cash** | Paid at the counter. | Staff tap **पैसे मिल गए** — except in test mode. |

- The shop's original Paytm standee QR decodes to `upi://pay?pa=paytm.s3zpul3@pty&pn=Paytm&tn=Verified Paytm Account` (static, no amount). Our QR keeps `@` literal like Paytm does.
- Offline/QR merchant ID (MID): `SnLKBT73909260588936` (not secret).
- Legal: the shop collects into its own account, in person, like its own standee; we are not a payment aggregator. Card data never touches our app (stays on Paytm's certified machine). GST bills come from the app; registration/accounting questions go to the owner's CA.
- **Before real customers:** run the ₹1 test (below) and set **`TEST_MODE=0`** in Vercel.

## Test mode (`lib/testmode.ts`) — currently ON everywhere

- On unless `TEST_MODE=0`. Owner asked for it on in production too until launch.
- Cash counts as paid → straight to the kitchen rail; red "TEST MODE" ribbon on the kiosk.
- A "Payment test" item at ₹1 (₹1 + 5% GST rounds to ₹1) appears in a "Payment test" section; the server refuses it when test mode is off.
- UPI stays real in test mode. Pending: ₹1 test from **GPay, PhonePe and Paytm** — check payee name, no "unverified merchant" block, soundbox announces, पैसे मिल गए moves it to the rail.

## Next: automatic confirmation (no staff tap)

Always needs the provider to tell our server "paid". Do **not** build a notification-scraping hack (reading the Paytm app's "₹X received" on a phone): fragile, mismatches, likely against Paytm's app terms.

### Route E — Easebuzz (chosen 2026-11-14: the shop's own account, live keys exist)

The shop already has an Easebuzz merchant account (the current third-party kiosk uses it and shows the
QR inside its own app). Docs: <https://docs.easebuzz.in/> (payment gateway → Seamless Integration, UPI,
Transaction API V2.1, Transaction Webhook). Read on 2026-11-14.

- **Flow for a UPI QR on our own screen ("UPI deep linking"):**
  1. `POST {pay}/payment/initiateLink` (form-encoded): `key, txnid (≤40 chars, ours), amount ("219.0"),
     productinfo (≤45), firstname, email, phone, surl, furl, request_flow=SEAMLESS, hash` → `{status:1, data:<access_key>}`.
     Hash = sha512 of `key|txnid|amount|productinfo|firstname|email|udf1|…|udf10|salt`.
  2. `POST {pay}/initiate_seamless_payment/` with `access_key, payment_mode=UPI, upi_qr=true, request_mode=SUVA`
     → JSON `{status:true, qr_link:"upi://pay?…"}`. We draw the QR from `qr_link`.
  3. Paid or failed: **Transaction Webhook** (form-encoded POST to a URL set in the Easebuzz dashboard:
     `txnid, status (success|failure|userCancelled|…), amount, easepayid, bank_ref_num, mode, hash`; answer 200
     within 10 s; retried 5 times, 30 min apart) **and** `POST {dashboard}/transaction/v2.1/retrieve`
     (`key, txnid, hash = sha512(key|txnid|salt)`) for polling. Easebuzz says both are mandatory for the QR flow.
  4. Always verify the response hash (reverse sequence) and re-check with the status API before marking paid.
- Hosts: sandbox `testpay.easebuzz.in` + `testdashboard.easebuzz.in`; live `pay.easebuzz.in` + `dashboard.easebuzz.in`.
- **Probes (2026-11-14):** on the test kit "benne 14" and on the live account (one ₹1 request, unpaid),
  `initiateLink` and the status API work; **`initiate_seamless_payment` is refused on both** ("Seamless
  payment mode access not authorised for merchant"). Easebuzz's **own payment page** (`{pay}/pay/<access_key>`,
  limited to UPI with `show_payment_mode=UPI`) works on both and can be shown in a frame (no frame-blocking headers).
- **Built (2026-11-14), off until switched on:** `lib/easebuzz.ts` (requests, signatures), `lib/gateway.ts`
  (`settle`: the one place an order is marked paid by the gateway), `POST /api/orders/[id]/gateway`
  (`start` / `check`), `POST /api/payments/easebuzz/webhook`, the kiosk's UPI screen.
  - The kiosk shows Easebuzz's page in a frame (customer taps "Pay by QR", then "Pay ₹…", and scans).
    With `EASEBUZZ_SEAMLESS=1` (once Easebuzz enables it) the kiosk draws the QR itself: no extra taps.
  - Paid is decided only by asking Easebuzz's status API: signed reply, `status=success`, exact amount,
    a payment reference. The webhook and the kiosk's 3-second check both end in that same function.
  - Wrong amount, or paid after the order was cancelled: the order is **not** marked paid and a
    "payment" line appears in the dashboard's change history so the owner can refund.
  - Easebuzz down or refusing: the kiosk falls back to the shop's own QR and "I've paid".
- **Sandbox end to end (2026-11-14):** the sandbox QR is a link to Easebuzz's test page that plays the
  customer's UPI app (type the PIN it shows, choose Success / Failure / Delayed). A ₹219 order went
  kiosk → page → Success → order number by itself, with the Easebuzz reference in the order's history.
- **To switch on (per environment):** in Vercel set `PAYMENTS=easebuzz`, `EASEBUZZ_KEY`, `EASEBUZZ_SALT`,
  `EASEBUZZ_ENV=test|live` (and `EASEBUZZ_SEAMLESS=1` when enabled), then redeploy; run migration 0007;
  in the Easebuzz dashboard (Payment Gateway → Account Settings → Webhooks → Transaction webhook) set
  `https://<site>/api/payments/easebuzz/webhook`. `/api/health` shows `payments: easebuzz` when it is on.
- **Before live:** Easebuzz regenerates the live key and salt (both were shown in chat); a real ₹1 payment
  from GPay, PhonePe and Paytm; confirm UPI fee and settlement time; decide who refunds and how
  (Easebuzz dashboard, or their Refund API V2 later).
- Tests: `tests/unit/easebuzz.test.ts`, `tests/e2e/gateway.spec.ts` against `tests/support/fake-easebuzz.mjs`
  (a stand-in that signs and answers like Easebuzz; no real calls in CI).

### Route E2 — Easebuzz InstaCollect "Dynamic QR" (what the shop's current kiosk uses; preferred, not built yet)

Found 2026-11-14 after a real ₹1 test on Route E: the money was received (Easebuzz payment id on the
order), but in Easebuzz's **Payment Gateway** product. The owner's Easebuzz app and current kiosk use a
different Easebuzz product, **InstaCollect / QR** ("Static QR | Dynamic QR", the shop's virtual UPI ID
ending `@mairtel`), and that is where the owner looks for the money. Same Easebuzz account, two
products, separate keys and separate places in the dashboard.

- Docs: <https://docs.easebuzz.in/> → Neobanking → InstaCollect Orders (Dynamic QR), and its webhooks.
- `POST https://wire.easebuzz.in/api/v1/insta-collect/order/create/` (JSON; headers `WIRE-API-KEY` and
  `Authorization` = sha512 of `key|unique_request_number|amount|per_transaction_amount|udf1…udf5|salt`)
  with `unique_request_number` (5–32 chars, ours), `amount`, `customer_name`, `customer_phone`,
  `allowed_collection_modes: ["upi"]`, `expiry_date` → the order's `virtual_account.upi_handle`,
  `upi_qrcode_url` and a `payment_link` (UPI string). **We draw the QR on our own screen: no extra taps.**
- Paid: webhook `ORDER_STATUS_UPDATE` with `status: completed` and the transaction (amount, UPI
  reference, payer), signed (`key|unique_request_number|amount|per_transaction_amount|status|udf1…udf5|salt`);
  and `GET …/insta-collect/order/{id}/` (hash `key|order_id|salt`) to ask directly. Cancel: `…/order/{id}/cancel`.
- **Needs from Easebuzz:** the InstaCollect ("Wire") API key and salt. The Payment Gateway key is
  refused there ("Invalid key", checked with one read-only call). Also ask: is there a test environment
  for InstaCollect; must our server's IP be whitelisted (Vercel has no fixed IP); webhook setup; charges.
- Plan: same shape as Route E (`settle()` asks Easebuzz before marking paid; fallback to the shop's own
  QR), with a second provider behind the same kiosk screen.

### Route A — Paytm card machine, cloud "Connection via Payment Request" (most promising)
- Works with the owner's existing Paytm Android EDC on the **same MID**; Paytm says EDC/DQR integration is free. Probably does **not** need the stuck online-merchant account.
- Flow: server `POST /edc-integration-service/payment/request` with head `{clientId, reqHash}` and body `{mid, merchantTxnId, txnAmount (paise, no decimals), txnDate?}` → Paytm returns a 6-digit Payment Request ID (CPay) → any machine on that MID pulls it (amount pre-filled) → customer taps card → we poll `GET /edc-integration-service/txn/status` (IN_QUEUE / PENDING / FAILED / COMPLETED / EXPIRED / CANCELLED) → COMPLETED moves the order to the kitchen. No webhook documented: poll.
- Staging host in docs: `securegw-stage.paytmpayments.in` (the curl example shows `securestage.paytmpayments.com` — confirm). Error EDC_0014 = JWT/auth failure, EDC_0019 = merchant not configured.
- **Needed from Paytm:** `clientId` + the hash/checksum key (staging + production). Not in the dashboard docs; ask support / the person who supplied the machine.
- Ask too: can the machine take **UPI QR on its own screen** through the same integration (would give automatic UPI confirmation without enterprise Dynamic QR)? Any charges?
- To confirm once we have access: does the machine show new requests automatically, or does staff enter the 6-digit ID shown on the kiosk?
- Other EDC modes (wired USB with .NET/Java SDK, Bluetooth with BT Connect app, one-to-one pairing) don't fit a tablet kiosk.
- Docs: <https://www.paytmpayments.com/docs/pos-connection-via-payment-request/> · <https://www.paytmpayments.com/docs/api/pos-payment-request-api>

### Route B — Paytm online merchant (payment gateway)
- Dashboard for offline merchants: **<https://dashboard.paytm.com/login/>** (same login as the Paytm for Business app). Not `dashboard.paytmpayments.com` — that didn't work for the owner.
- Steps: Explore Online Payments → Activate account for Website/App → business details + website URL (use the Vercel **production** domain, or buy one e.g. `benne14.in`) → creates a new online MID → Developer Settings → API Keys: **Test API Details** ("Generate now") and **Production API Details**.
- **Status (2026-11-12): blocked by Paytm** — "Online Merchant create request cannot be processed due to some system maintenance", also when generating *test* keys. Retry later / from a desktop browser; if it persists, Help & Support ticket for MID `SnLKBT73909260588936`.
- Then: **Dynamic QR** (per-order QR on our screen + webhook + status API) is officially "only available to select enterprise customers with high transaction volumes" — request it, expect a possible no. Fallback: Paytm standard checkout / JS Checkout (Paytm's payment window on the kiosk, QR + UPI apps), open to normal merchants once activated. Ask about UPI fees on the gateway.
- Docs: <https://paytmpayments.com/docs/dynamic-qr-code-payments> · <https://paytmpayments.com/docs/api/create-qr-code-api> · <https://business.paytm.com/blog/how-to-generate-api-key-for-payment-gateway-integration-offline-merchants/>

### Route C — Razorpay (parked by the owner)
- Instant test keys, UPI QR API with `qr_code.credited` webhook; live needs KYC (PAN, address, bank + IFSC, two business documents under the 2026 rule, website policy pages). Fees: UPI QR 0.99% + 18% GST (~1.17%), standard UPI checkout 2% + GST. Settles via Razorpay, not into Paytm.

## Credentials (env only — never in chat or git)
- Paytm gateway: `PAYTM_MID`, `PAYTM_MERCHANT_KEY`, `PAYTM_ENV=test|live`.
- Paytm EDC cloud: names to decide when we get them (e.g. `PAYTM_EDC_CLIENT_ID`, `PAYTM_EDC_KEY`).
- Add in Vercel (Production + Preview) **and** the Claude environment settings; new values appear in the next session.

## Message for Paytm support (owner can paste)
> We run Benne 14 (MID SnLKBT73909260588936) and built our own self-order kiosk. (1) Please enable **EDC integration – Connection via Payment Request (cloud)** for our Paytm Android card machine and share the **clientId and checksum/hash key** for staging and production. Can the same integration take **UPI QR on the machine** with status via the API? (2) On dashboard.paytm.com, "Generate now" for Test API Keys and "Activate account for Website/App" fail with "Online Merchant create request cannot be processed due to some system maintenance" — please create the online merchant account. (3) Is **Dynamic QR** available to us, and what are the UPI fees for these setups?
