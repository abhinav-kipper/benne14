import { addDays, istDay } from '@/lib/orders';
import { counts } from '@/lib/reports';
import { getStore } from '@/lib/store';
import { json } from '@/lib/server';
import { bestSellers } from '@/lib/suggest';

export const dynamic = 'force-dynamic';

// The shop's best sellers over the last two weeks, best first: item ids only, so it is safe to be
// public. The kiosk uses it to order its "Anything else?" suggestions. Worked out at most every ten
// minutes per server; if it can't be, the kiosk simply falls back to the menu's own order.
const DAYS = 14;
let cache: { at: number; ids: string[] } | null = null;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > 10 * 60_000) {
      const today = istDay();
      const orders = await getStore().listRange(addDays(today, -(DAYS - 1)), today);
      cache = { at: Date.now(), ids: bestSellers(orders.filter(counts)) };
    }
    return json({ ids: cache.ids });
  } catch (e) {
    console.error(e);
    return json({ ids: [] });
  }
}
