import { adminDenied, cleanPrice } from '@/lib/admin';
import { cleanCode, describeCode, type DiscountCode, type KioskSettings } from '@/lib/discounts';
import { isDay, istDay, type AdminEvent } from '@/lib/orders';
import { getStore } from '@/lib/store';
import { BadRequest, fail, json, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';

// The dashboard's Offers tab: the kiosk switches and the discount codes.
export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const store = getStore();
    const [settings, codes] = await Promise.all([store.getSettings(), store.listCodes()]);
    return json({ settings, codes, today: istDay() });
  } catch (e) {
    return fail(e);
  }
}

// { settings: { codes?, phone? } } switches what the kiosk asks for.
// { code: { code, kind, value, minOrder?, maxDiscount?, expiresOn?, active? } } creates a code or replaces it.
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const b = await readJson(req);
    const store = getStore();

    if (b.settings !== undefined) {
      const s = b.settings as Record<string, unknown> | null;
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw new BadRequest('Bad settings');
      const patch: Partial<KioskSettings> = {};
      for (const k of ['codes', 'phone'] as const) {
        if (s[k] === undefined) continue;
        if (typeof s[k] !== 'boolean') throw new BadRequest(`${k} must be true or false`);
        patch[k] = s[k];
      }
      const before = await store.getSettings();
      const label = { codes: 'Discount codes on the kiosk', phone: 'Phone number on the kiosk' };
      const events: Omit<AdminEvent, 'at'>[] = (['codes', 'phone'] as const)
        .filter((k) => patch[k] !== undefined && patch[k] !== before[k])
        .map((k) => ({
          kind: 'setting',
          subject: label[k],
          before: before[k] ? 'On' : 'Off',
          after: patch[k] ? 'On' : 'Off',
        }));
      return json({ settings: await store.saveSettings(patch, events) });
    }

    const c = b.code as Record<string, unknown> | null;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new BadRequest('Send settings or a code');
    const code = cleanCode(c.code);
    if (!code) throw new BadRequest('A code is 3 to 16 letters and digits, like WELCOME10');
    if (c.kind !== 'percent' && c.kind !== 'flat') throw new BadRequest('Pick percent or rupees off');
    const value = cleanPrice(c.value, c.kind === 'percent' ? 'Percent' : 'Amount');
    if (value == null) throw new BadRequest('Say how much the code takes off');
    if (c.kind === 'percent' && value > 90) throw new BadRequest('A percentage code can take off 90% at most');
    const minOrder = cleanPrice(c.minOrder ?? null, 'Minimum order') ?? null;
    const maxDiscount = c.kind === 'percent' ? (cleanPrice(c.maxDiscount ?? null, 'Maximum discount') ?? null) : null;
    if (c.kind === 'flat' && (!minOrder || minOrder <= value))
      throw new BadRequest(`A ₹${value} off code needs a minimum order above ₹${value}`);
    if (c.expiresOn != null && c.expiresOn !== '' && !isDay(c.expiresOn)) throw new BadRequest('Pick a valid last day');
    if (c.active !== undefined && typeof c.active !== 'boolean') throw new BadRequest('Active must be true or false');
    const next: DiscountCode = {
      code,
      kind: c.kind,
      value,
      minOrder,
      maxDiscount,
      expiresOn: (c.expiresOn as string) || null,
      active: (c.active as boolean | undefined) ?? true,
    };
    const was = await store.getCode(code);
    const say = (x: DiscountCode) =>
      `${describeCode(x)}${x.expiresOn ? `, until ${x.expiresOn}` : ''} · ${x.active ? 'on' : 'off'}`;
    await store.saveCode(next, { kind: 'discount', subject: code, before: was ? say(was) : null, after: say(next) });
    return json({ code: next });
  } catch (e) {
    return fail(e);
  }
}
