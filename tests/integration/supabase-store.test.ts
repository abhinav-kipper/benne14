// Runs the store contract against the real SupabaseStore, talking to a real Postgres through
// PostgREST (what Supabase's REST API is). CI starts both and runs the migrations (see the `db` job
// in .github/workflows/ci.yml). Skipped when DB_TEST_URL isn't set, e.g. on a laptop.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SupabaseStore } from '@/lib/store/supabase';
import { storeContract } from '../support/store-contract';

const URL_ = process.env.DB_TEST_URL; // PostgREST, e.g. http://localhost:3000
const SECRET = process.env.DB_TEST_JWT_SECRET ?? '';

// Supabase serves PostgREST under /rest/v1; a bare PostgREST serves it at the root.
const bare: typeof fetch = (input, init) =>
  fetch(String(input instanceof Request ? input.url : input).replace('/rest/v1/', '/'), init);
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function key(role: string) {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
const rest = (path: string, role: string, init: RequestInit = {}) =>
  fetch(`${URL_}/${path}`, {
    ...init,
    headers: {
      apikey: key(role),
      Authorization: `Bearer ${key(role)}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

describe.skipIf(!URL_)('Supabase store on a real database', () => {
  const wipe = async () => {
    // order matters only for readability; there are no foreign keys
    for (const t of [
      'orders?id=not.is.null',
      'token_counters?day=not.is.null',
      'menu_overrides?item_id=not.is.null',
      'option_overrides?group_id=not.is.null',
      'admin_events?id=not.is.null',
      'discount_codes?code=not.is.null',
      'kiosk_settings?id=not.is.null', // no row = the defaults (both on)
    ]) {
      const r = await rest(t, 'service_role', { method: 'DELETE' });
      if (!r.ok) throw new Error(`wipe ${t}: ${r.status} ${await r.text()}`);
    }
  };

  storeContract('supabase', async () => {
    await wipe();
    return new SupabaseStore(URL_!, key('service_role'), bare);
  });

  it('keeps orders private: the public (anon) key sees nothing and cannot place orders', async () => {
    await wipe();
    const s = new SupabaseStore(URL_!, key('service_role'), bare);
    const { priceOrder } = await import('@/lib/pricing');
    await s.placeOrder({
      key: 'private-check-0001',
      type: 'takeaway',
      customerName: 'Secret',
      payMethod: 'cash',
      priced: priceOrder([{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }]),
    });
    const read = await rest('orders?select=*', 'anon');
    expect(read.ok ? await read.json() : []).toEqual([]); // row-level security: no rows, or no permission at all
    const call = await rest('rpc/place_order', 'anon', {
      method: 'POST',
      body: JSON.stringify({ p_key: 'anon-try-0001', p_type: 'takeaway', p_name: '', p_pay: 'cash', p_priced: {} }),
    });
    expect(call.ok).toBe(false);
    const edit = await rest('rpc/save_menu_edit', 'anon', {
      method: 'POST',
      body: JSON.stringify({ p_item_id: 'masala-dosa', p_item: { price: 1 }, p_options: [], p_events: [] }),
    });
    expect(edit.ok).toBe(false);
    for (const t of ['customers?select=*', 'discount_codes?select=*', 'kiosk_settings?select=*']) {
      const r = await rest(t, 'anon');
      expect(r.ok ? await r.json() : [], t).toEqual([]); // phone numbers and codes are not public
    }
  });
});
