import { cleanCode, cleanPhone, usable, type DiscountRule } from '@/lib/discounts';
import { priceOrder, type CartLine } from '@/lib/pricing';
import { itemById, mergeCatalog } from '@/lib/menu';
import { createHash } from 'node:crypto';
import { cleanName, isCheckoutKey, isPaid, istDay, storedKey, type OrderType, type PayMethod } from '@/lib/orders';
import { after } from 'next/server';
import { ordersToRecheck, recheck } from '@/lib/gateway';
import { getStore } from '@/lib/store';
import { fail, json, paymentMode, readJson } from '@/lib/server';
import { isTestMode } from '@/lib/testmode';

export const dynamic = 'force-dynamic';

// Kiosk checkout. The body carries item ids and choices only; prices come from the server's menu.
export async function POST(req: Request) {
  try {
    const b = (await readJson(req)) as {
      key?: unknown;
      type?: unknown;
      name?: unknown;
      payMethod?: unknown;
      lines?: unknown;
      code?: unknown;
      phone?: unknown;
      expectTotal?: unknown;
    };
    if (!isCheckoutKey(b.key)) return json({ error: 'Missing checkout key' }, 400);
    if (b.type !== 'dine_in' && b.type !== 'takeaway') return json({ error: 'Pick dine-in or takeaway' }, 400);
    if (b.payMethod !== 'upi' && b.payMethod !== 'card' && b.payMethod !== 'cash')
      return json({ error: 'Pick a payment method' }, 400);
    if (!Array.isArray(b.lines) || b.lines.length > 40) return json({ error: 'Bad cart' }, 400);
    const name = cleanName(b.name);
    // Optional fields: missing or '' is fine, a wrong value is said out loud rather than dropped.
    const given = (v: unknown) => v != null && v !== '';
    const phone = given(b.phone) ? cleanPhone(b.phone) : null;
    if (given(b.phone) && !phone) return json({ error: 'Check the phone number: it needs 10 digits.' }, 400);
    const code = given(b.code) ? cleanCode(b.code) : null;
    if (given(b.code) && !code) return json({ error: 'That code isn’t valid.' }, 400);
    if (
      !isTestMode() &&
      (b.lines as CartLine[]).some((l) => itemById((l as Partial<CartLine> | null)?.itemId ?? '')?.testOnly)
    )
      return json({ error: 'That item is only for testing' }, 400);
    if (b.expectTotal !== undefined && !Number.isSafeInteger(b.expectTotal))
      return json({ error: 'Bad expected total' }, 400);
    const store = getStore();

    // Is this a retry? The same key with the same request is: hand back the order already saved,
    // before any check that may have changed since (a dish sold out, a code switched off).
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([b.type, b.payMethod, name, phone, code, b.lines]))
      .digest('hex')
      .slice(0, 24);
    const before = await store.findByCheckout(b.key);
    if (before && before.fingerprint === fingerprint) return json(before.order, 201);

    // Price from the menu as the owner set it (prices, sold out today), never from the request.
    const catalog = mergeCatalog(await store.getOverrides());
    const out = (b.lines as CartLine[])
      .map((l) => itemById((l as Partial<CartLine> | null)?.itemId ?? '', catalog))
      .find((i) => i?.soldOut);
    if (out) return json({ error: `Sorry, ${out.name} just sold out. Please remove it from your order.` }, 409);
    // The owner's switches decide what is taken: a code or a number sent while its switch is off is not used.
    const settings = phone || code ? await store.getSettings() : null;
    let rule: DiscountRule | null = null;
    if (code) {
      const found = settings!.codes ? await store.getCode(code) : null;
      if (!found || !usable(found, istDay()))
        return json({ error: `Code ${code} is no longer valid. Remove it to continue.` }, 409);
      rule = found;
    }
    const priced = priceOrder(b.lines as CartLine[], catalog, rule);
    // The customer was shown a discount: never charge the full price without saying so.
    if (rule && !priced.discountCode)
      return json(
        { error: `Code ${rule.code} needs an order of ₹${rule.minOrder} or more. Add a dish or remove the code.` },
        409,
      );
    // The kiosk says what total it showed. If the menu or a code changed since, don't charge a
    // different amount without the customer seeing it first.
    if (b.expectTotal !== undefined && b.expectTotal !== priced.total)
      return json({ error: `Prices just changed: the total is now ₹${priced.total}. Please check your order.` }, 409);
    // Same key, different request: the customer changed the order after a checkout whose reply was
    // lost. The earlier order was never shown to them, so it is withdrawn, unless it is already paid.
    if (before) {
      if (isPaid(before.order))
        return json(
          { error: `Order ${before.order.token} was already placed and paid. Please ask at the counter.` },
          409,
        );
      if (before.order.status !== 'cancelled') await store.setStatus(before.order.id, 'cancelled');
    }
    let order = await store.placeOrder({
      key: storedKey(b.key, fingerprint),
      type: b.type as OrderType,
      customerName: name,
      customerPhone: settings?.phone ? phone : null,
      payMethod: b.payMethod as PayMethod,
      priced,
    });
    // Test mode: treat cash as paid so the whole flow can be tried without the counter step.
    if (isTestMode() && order.payMethod === 'cash' && order.status === 'awaiting_cash')
      order = await store.setStatus(order.id, 'new');
    return json(order, 201);
  } catch (e) {
    return fail(e);
  }
}

// Live orders for the kitchen and the board. ?view=today: today's full history, newest first.
// ?view=collected: just the last few collected order numbers (the TV's "Collected" row).
export async function GET(req: Request) {
  try {
    const store = getStore();
    const view = new URL(req.url).searchParams.get('view');
    if (view === 'today') return json(await store.listToday());
    if (view === 'collected') return json(await store.listCollected(8));
    const live = await store.listLive();
    // Payments still open are re-checked with the gateway after this answer is sent, so a customer who
    // pays after the kiosk moved on still gets their order (see lib/gateway.ts).
    if (paymentMode() === 'easebuzz') {
      const due = ordersToRecheck(live);
      if (due.length) after(() => recheck(due));
    }
    return json(live);
  } catch (e) {
    return fail(e);
  }
}
