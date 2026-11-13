import { cleanCode, discountFor, usable, type DiscountRule } from '@/lib/discounts';
import { mergeCatalog } from '@/lib/menu';
import { istDay } from '@/lib/orders';
import { priceOrder, type CartLine } from '@/lib/pricing';
import { FailureLimiter } from '@/lib/ratelimit';
import { getStore } from '@/lib/store';
import { clientKey, fail, json, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Guessing codes: 10 wrong ones from an address in 10 minutes, then wait.
const wrong = new FailureLimiter(10, 10 * 60_000);

// The kiosk asks whether a code works for this cart: { code, lines } → the rule and what it takes off.
// The order itself is priced again at checkout; this only lets the cart show the discount.
export async function POST(req: Request) {
  try {
    const who = clientKey(req);
    if (wrong.locked(who)) return json({ error: 'Too many tries. Please ask at the counter.' }, 429);
    const b = await readJson(req);
    if (!Array.isArray(b.lines) || b.lines.length > 40) return json({ error: 'Bad cart' }, 400);
    const code = cleanCode(b.code);
    const store = getStore();
    const settings = await store.getSettings();
    const found = code && settings.codes ? await store.getCode(code) : null;
    if (!found || !usable(found, istDay())) {
      wrong.fail(who);
      return json({ error: 'That code isn’t valid. Check the spelling or ask at the counter.' }, 404);
    }
    const rule: DiscountRule = {
      code: found.code,
      kind: found.kind,
      value: found.value,
      minOrder: found.minOrder,
      maxDiscount: found.maxDiscount,
    };
    const gross = priceOrder(b.lines as CartLine[], mergeCatalog(await store.getOverrides())).subtotal;
    return json({ rule, ...discountFor(gross, rule) });
  } catch (e) {
    return fail(e);
  }
}
