import { cleanCode, cleanPhone, usable, type DiscountRule } from '@/lib/discounts';
import { priceOrder, type CartLine } from '@/lib/pricing';
import { itemById, mergeCatalog } from '@/lib/menu';
import { cleanName, istDay, type OrderType, type PayMethod } from '@/lib/orders';
import { getStore } from '@/lib/store';
import { fail, json, readJson } from '@/lib/server';
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
    };
    if (typeof b.key !== 'string' || b.key.length < 8 || b.key.length > 80)
      return json({ error: 'Missing checkout key' }, 400);
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
    const store = getStore();
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
    let order = await store.placeOrder({
      key: b.key,
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
    return json(await store.listLive());
  } catch (e) {
    return fail(e);
  }
}
