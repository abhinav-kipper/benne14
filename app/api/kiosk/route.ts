import { usable } from '@/lib/discounts';
import { istDay } from '@/lib/orders';
import { getStore } from '@/lib/store';
import { fail, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// What the kiosk's cart asks for, as the owner switched it in the dashboard. Public: it only says
// which fields to show. The code field also needs a code that works today, or it would lead nowhere.
export async function GET() {
  try {
    const store = getStore();
    const s = await store.getSettings();
    const today = istDay();
    const codes = s.codes && (await store.listCodes()).some((c) => usable(c, today));
    return json({ codes, phone: s.phone });
  } catch (e) {
    return fail(e);
  }
}
