import { usable } from '@/lib/discounts';
import { istDay } from '@/lib/orders';
import { getStore } from '@/lib/store';
import { fail, json, kioskOk, newKioskKey, staffCheck, staffDenied } from '@/lib/server';

export const dynamic = 'force-dynamic';

// What the kiosk's cart asks for, as the owner switched it in the dashboard. Public: it only says
// which fields to show. The code field also needs a code that works today, or it would lead nowhere.
export async function GET(req: Request) {
  try {
    const store = getStore();
    const s = await store.getSettings();
    const today = istDay();
    const codes = s.codes && (await store.listCodes()).some((c) => usable(c, today));
    // enrolled: has this tablet been set up as the shop's kiosk? (It sends its key with the request.)
    return json({ codes, phone: s.phone, enrolled: kioskOk(req) });
  } catch (e) {
    return fail(e);
  }
}

// Set this tablet up as the shop's kiosk: staff type the staff PIN once, the tablet gets a key and
// keeps it. Orders are accepted only with a key (POST /api/orders).
export async function POST(req: Request) {
  const pin = staffCheck(req);
  if (pin !== 'ok') return staffDenied(pin);
  return json({ key: newKioskKey() });
}
