// Discount codes, the kiosk's switches and the customer list.
import { DEFAULT_SETTINGS, type Customer, type DiscountCode, type KioskSettings } from '../../discounts';
import { type AdminEvent } from '../../orders';
import { StoreError } from '../memory';
import { eventRow, missing, noColumn, toCode, type CodeRow, type Db } from './shared';
import { addEvent } from './events';

export async function listCodes(db: Db) {
  const { data, error } = await db
    .from('discount_codes')
    .select('code,kind,value,min_order,max_discount,expires_on,active')
    .order('created_at', { ascending: false });
  if (missing(error)) return [];
  if (error) throw new StoreError(error.message, 500);
  return (data as CodeRow[]).map(toCode);
}

export async function getCode(db: Db, code: string) {
  const { data, error } = await db
    .from('discount_codes')
    .select('code,kind,value,min_order,max_discount,expires_on,active')
    .eq('code', code)
    .maybeSingle();
  if (missing(error)) return null;
  if (error) throw new StoreError(error.message, 500);
  return data ? toCode(data as CodeRow) : null;
}

export async function saveCode(db: Db, c: DiscountCode, event: Omit<AdminEvent, 'at'>) {
  const { error } = await db.from('discount_codes').upsert(
    {
      code: c.code,
      kind: c.kind,
      value: c.value,
      min_order: c.minOrder,
      max_discount: c.maxDiscount,
      expires_on: c.expiresOn,
      active: c.active,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'code' },
  );
  if (missing(error))
    throw new StoreError('Run supabase/migrations/0005_discount_codes_and_phone.sql in Supabase first', 503);
  if (error) throw new StoreError(error.message, 500);
  await addEvent(db, event);
}

export async function deleteCode(db: Db, code: string, event: Omit<AdminEvent, 'at'>) {
  const { data, error } = await db.from('discount_codes').delete().eq('code', code).select('code');
  if (missing(error)) throw new StoreError('No such code', 404);
  if (error) throw new StoreError(error.message, 500);
  if (!(data as unknown[]).length) throw new StoreError('No such code', 404);
  await addEvent(db, event);
}

export async function getSettings(db: Db): Promise<KioskSettings> {
  let { data, error } = await db.from('kiosk_settings').select('codes,phone,cash').eq('id', 1).maybeSingle();
  // Before migration 0016 there is no cash switch: read the rest, with cash off.
  if (noColumn(error))
    ({ data, error } = await db.from('kiosk_settings').select('codes,phone').eq('id', 1).maybeSingle());
  // Before migration 0005 nothing can be stored, so the kiosk shows neither field.
  if (missing(error)) return { codes: false, phone: false, cash: false };
  if (error) throw new StoreError(error.message, 500);
  return { ...DEFAULT_SETTINGS, ...(data as Partial<KioskSettings> | null) };
}

export async function saveSettings(db: Db, patch: Partial<KioskSettings>, events: Omit<AdminEvent, 'at'>[]) {
  const next = { ...(await getSettings(db)), ...patch };
  const write = (row: Partial<KioskSettings>) =>
    db.from('kiosk_settings').upsert({ id: 1, ...row, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  let { error } = await write(next);
  if (noColumn(error)) {
    if (patch.cash !== undefined)
      throw new StoreError('Run supabase/migrations/0016_cash_switch.sql in Supabase first', 503);
    ({ error } = await write({ codes: next.codes, phone: next.phone }));
  }
  if (missing(error))
    throw new StoreError('Run supabase/migrations/0005_discount_codes_and_phone.sql in Supabase first', 503);
  if (error) throw new StoreError(error.message, 500);
  if (events.length) {
    const ev = await db.from('admin_events').insert(events.map(eventRow));
    if (ev.error) throw new StoreError(ev.error.message, 500);
  }
  return next;
}

export async function listCustomers(db: Db): Promise<Customer[]> {
  const out: Customer[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('customers')
      .select('phone,name,orders,spent,first_order_at,last_order_at')
      .order('last_order_at', { ascending: false })
      .order('phone')
      .range(from, from + 999);
    if (missing(error)) return [];
    if (error) throw new StoreError(error.message, 500);
    const rows = data as {
      phone: string;
      name: string | null;
      orders: number;
      spent: string | number;
      first_order_at: string;
      last_order_at: string;
    }[];
    out.push(
      ...rows.map((r) => ({
        phone: r.phone,
        name: r.name,
        orders: +r.orders,
        spent: +r.spent,
        firstOrderAt: r.first_order_at,
        lastOrderAt: r.last_order_at,
      })),
    );
    if (rows.length < 1000) return out;
  }
}

// Watching the system. None of these may ever throw into a screen: a failed "I'm here" or a
