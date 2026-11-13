import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { priceOrder } from '@/lib/pricing';
import { MIGRATIONS } from '@/lib/migrations';

// Runs the real migrations in an in-memory Postgres (PGlite), so the SQL that runs in Supabase
// (place_order: daily numbers, idempotency, first status) is tested, not just the app around it.
const dir = path.resolve(__dirname, '../../supabase/migrations');
const priced = JSON.stringify(
  priceOrder([{ itemId: 'masala-dosa', qty: 2, choices: { dosaExtras: ['benne'] }, notes: ['less-oil'] }]),
);

let db: PGlite;
const place = async (key: string, pay = 'upi', name = 'Rahul') =>
  (
    await db.query<{
      id: string;
      token: string;
      status: string;
      total: string;
      customer_name: string | null;
      lines: unknown;
    }>('select * from place_order($1, $2, $3, $4, $5::jsonb)', [key, 'takeaway', name, pay, priced])
  ).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated;'); // Supabase's built-in roles
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(readFileSync(path.join(dir, f), 'utf8'));
});

describe('database (supabase/migrations)', () => {
  it('numbers orders 1, 2, 3… and stores what the app priced', async () => {
    const a = await place('db-key-1');
    const b = await place('db-key-2', 'cash');
    expect([a.token, b.token]).toEqual(['1', '2']);
    expect(Number(a.total)).toBe(JSON.parse(priced).total);
    expect(a.lines).toEqual(JSON.parse(priced).lines);
  });

  it('is idempotent on the checkout key: a retried checkout gets the same order and number', async () => {
    const first = await place('db-key-retry');
    const again = await place('db-key-retry');
    expect(again.id).toBe(first.id);
    const next = await place('db-key-after');
    expect(Number(next.token)).toBe(Number(first.token) + 1); // the retry didn't use up a number
  });

  it('starts UPI unpaid and card/cash at the counter', async () => {
    expect((await place('db-upi')).status).toBe('pending_payment');
    expect((await place('db-card', 'card')).status).toBe('awaiting_cash');
    expect((await place('db-cash', 'cash')).status).toBe('awaiting_cash');
  });

  it('stores an empty name as no name', async () => {
    expect((await place('db-noname', 'cash', '')).customer_name).toBeNull();
  });

  it('counts each day separately', async () => {
    const today = (await db.query<{ d: string }>("select ((now() at time zone 'Asia/Kolkata')::date)::text d")).rows[0]
      .d;
    await db.query("insert into token_counters values ((now() at time zone 'Asia/Kolkata')::date - 1, 500)");
    const t = await place('db-day');
    expect(Number(t.token)).toBeLessThan(500);
    const yesterday = (
      await db.query<{ last: number }>('select last from token_counters where day < $1::date', [today])
    ).rows[0];
    expect(yesterday.last).toBe(500);
  });

  it('refuses bad rows (unknown status or payment type)', async () => {
    await expect(db.query("update orders set status = 'eaten' where token = '1'")).rejects.toThrow();
    await expect(
      db.query("select place_order('db-bad', 'takeaway', '', 'bitcoin', $1::jsonb)", [priced]),
    ).rejects.toThrow();
  });

  it('keeps orders private: RLS on, and the public roles cannot call place_order', async () => {
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('orders', 'token_counters')",
    );
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
    const can = await db.query<{ anon: boolean; auth: boolean }>(
      "select has_function_privilege('anon', 'place_order(text,text,text,text,jsonb,text)', 'execute') anon, has_function_privilege('authenticated', 'place_order(text,text,text,text,jsonb,text)', 'execute') auth",
    );
    expect(can.rows[0]).toEqual({ anon: false, auth: false });
  });

  it('stores discount codes, the kiosk switches and phone numbers, with sane limits (0005)', async () => {
    await db.query(
      "insert into discount_codes (code, kind, value, min_order) values ('WELCOME10', 'percent', 10, 200)",
    );
    for (const bad of [
      "('lower', 'percent', 10)", // codes are upper-case letters and digits
      "('AB', 'percent', 10)",
      "('HALF', 'percent', 95)", // at most 90%
      "('ZERO', 'flat', 0)",
      "('ODD', 'bogof', 1)",
    ])
      await expect(db.query(`insert into discount_codes (code, kind, value) values ${bad}`), bad).rejects.toThrow();
    expect((await db.query('select codes, phone from kiosk_settings')).rows).toEqual([{ codes: true, phone: true }]);
    await expect(db.query('insert into kiosk_settings (id) values (2)')).rejects.toThrow(); // one row only

    const withCode = JSON.stringify({ ...JSON.parse(priced), savings: 42, discountCode: 'WELCOME10' });
    const o = (
      await db.query<{ id: string; discount_code: string; customer_phone: string; savings: string }>(
        'select * from place_order($1, $2, $3, $4, $5::jsonb, $6)',
        ['db-code-1', 'takeaway', 'Asha', 'cash', withCode, '9876543210'],
      )
    ).rows[0];
    expect(o).toMatchObject({ discount_code: 'WELCOME10', customer_phone: '9876543210', savings: '42.00' });
    await expect(
      db.query('select place_order($1, $2, $3, $4, $5::jsonb, $6)', [
        'db-code-2',
        'takeaway',
        '',
        'cash',
        priced,
        '12345',
      ]),
    ).rejects.toThrow(); // not a mobile number
    expect((await place('db-code-3')).customer_name).toBe('Rahul'); // the old 5-argument call still works

    // the customer list: paid orders only, and closed to the public roles
    expect((await db.query('select * from customers')).rows).toEqual([]);
    await db.query("update orders set status = 'new' where id = $1", [o.id]);
    expect((await db.query('select phone, name, orders from customers')).rows).toEqual([
      { phone: '9876543210', name: 'Asha', orders: 1 },
    ]);
    const can = await db.query<{ a: boolean; b: boolean; rls: number }>(
      "select has_table_privilege('anon', 'customers', 'select') a, has_table_privilege('authenticated', 'customers', 'select') b, (select count(*)::int from pg_class where relname in ('discount_codes','kiosk_settings') and relrowsecurity) rls",
    );
    expect(can.rows[0]).toEqual({ a: false, b: false, rls: 2 });
    await db.query("insert into admin_events (kind, subject) values ('discount', 'WELCOME10'), ('setting', 'Phone')");
  });

  it('has the owner dashboard tables, with sane limits', async () => {
    await db.query(
      "insert into menu_overrides (item_id, price, sold_out_on) values ('masala-dosa', 219, current_date)",
    );
    await expect(db.query("insert into menu_overrides (item_id, price) values ('plain-dosa', 0)")).rejects.toThrow();
    await expect(db.query("insert into menu_overrides (item_id, name) values ('plain-dosa', '')")).rejects.toThrow();
    await db.query("insert into option_overrides values ('dosaExtras', 'benne', 30)");
    await expect(db.query("insert into option_overrides values ('dosaExtras', 'podi', -1)")).rejects.toThrow();
    await db.query(
      "insert into admin_events (kind, subject, before, after) values ('price', 'Masala Dosa', '₹209', '₹219')",
    );
    await expect(db.query("insert into admin_events (kind, subject) values ('hack', 'x')")).rejects.toThrow();
    const o = await place('db-refund', 'cash');
    await db.query(
      "update orders set refunded_at = now(), refund_reason = 'Wrong order', refund_amount = total where id = $1",
      [o.id],
    );
    const rls = await db.query<{ n: number }>(
      "select count(*)::int n from pg_class where relname in ('menu_overrides','option_overrides','admin_events') and relrowsecurity",
    );
    expect(rls.rows[0].n).toBe(3);
  });

  it('migrations can run twice (safe to re-run in Supabase)', async () => {
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort())
      await db.exec(readFileSync(path.join(dir, f), 'utf8'));
  });

  it('saves a menu edit in one go: only the given fields change, null resets, history is written', async () => {
    const edit = (item: object, options: object[] = [], events: object[] = []) =>
      db.query('select save_menu_edit($1, $2::jsonb, $3::jsonb, $4::jsonb)', [
        'thatte-idli',
        JSON.stringify(item),
        JSON.stringify(options),
        JSON.stringify(events),
      ]);
    await edit(
      { price: 99, name: 'Big Thatte Idli' },
      [{ group_id: 'idliExtras', option_id: 'ghee', price: 20 }],
      [{ kind: 'price', subject: 'Thatte Idli', before: '₹89', after: '₹99' }],
    );
    await edit({ sold_out_on: '2026-11-13' });
    const row = async () =>
      (
        await db.query<{ name: string | null; price: number | null; sold_out_on: Date | string | null }>(
          "select name, price, sold_out_on from menu_overrides where item_id = 'thatte-idli'",
        )
      ).rows[0];
    expect(await row()).toMatchObject({ name: 'Big Thatte Idli', price: 99 }); // the second edit left them alone
    expect((await row()).sold_out_on).not.toBeNull();
    await edit({ name: null, sold_out_on: null });
    expect(await row()).toMatchObject({ name: null, price: 99, sold_out_on: null });
    expect(
      (await db.query<{ price: number }>("select price from option_overrides where option_id = 'ghee'")).rows[0].price,
    ).toBe(20);
    expect(
      (await db.query<{ n: number }>("select count(*)::int n from admin_events where subject = 'Thatte Idli'")).rows[0]
        .n,
    ).toBe(1);
    // a bad value fails the whole edit: nothing is half-saved
    await expect(edit({ price: 119 }, [{ group_id: 'idliExtras', option_id: 'sambar', price: -5 }])).rejects.toThrow();
    expect((await row()).price).toBe(99);
    const can = await db.query<{ anon: boolean }>(
      "select has_function_privilege('anon', 'save_menu_edit(text,jsonb,jsonb,jsonb)', 'execute') anon",
    );
    expect(can.rows[0].anon).toBe(false);
  });

  it('records which migrations have run, matching lib/migrations.ts and the folder', async () => {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => f.replace('.sql', ''));
    expect(files).toEqual(MIGRATIONS);
    const applied = (await db.query<{ name: string }>('select name from schema_migrations order by name')).rows.map(
      (r) => r.name,
    );
    expect(applied).toEqual(MIGRATIONS);
  });
});
