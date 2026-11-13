import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { priceOrder } from '@/lib/pricing';
import { MIGRATIONS } from '@/lib/migrations';
import { canMove, type OrderStatus } from '@/lib/orders';

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
    await db.query("update orders set status = 'new', paid_at = now() where id = $1", [o.id]); // paid at the counter
    await db.query(
      "update orders set refunded_at = now(), refund_reason = 'Wrong order', refund_amount = total where id = $1",
      [o.id],
    );
    const rls = await db.query<{ n: number }>(
      "select count(*)::int n from pg_class where relname in ('menu_overrides','option_overrides','admin_events') and relrowsecurity",
    );
    expect(rls.rows[0].n).toBe(3);
  });

  describe('order integrity (0006)', () => {
    const ALL: OrderStatus[] = [
      'pending_payment',
      'awaiting_cash',
      'new',
      'cooking',
      'ready',
      'handed_over',
      'cancelled',
    ];
    let seq = 0;
    const raw = (over: Record<string, unknown>) => {
      seq += 1;
      const row: Record<string, unknown> = {
        idempotency_key: `raw-key-${seq}`,
        token: `r${seq}`,
        token_day: '2031-01-01',
        type: 'takeaway',
        pay_method: 'cash',
        status: 'awaiting_cash',
        lines: '[]',
        item_count: 1,
        subtotal: 100,
        cgst: 2.5,
        sgst: 2.5,
        round_off: 0,
        total: 105,
        savings: 0,
        ...over,
      };
      const cols = Object.keys(row);
      const marks = cols.map((_, i) => '$' + (i + 1));
      return db.query(
        'insert into orders (' + cols.join(',') + ') values (' + marks.join(',') + ') returning id',
        Object.values(row),
      );
    };

    it('refuses a bill that does not add up, whoever writes it', async () => {
      await raw({}); // a sound bill goes in
      const bad: [string, Record<string, unknown>][] = [
        ['total too high', { total: 106 }],
        ['GST missing from the total', { total: 100 }],
        ['CGST and SGST differ', { cgst: 3, sgst: 2 }],
        ['negative taxable value', { subtotal: -100, cgst: 0, sgst: 0, total: -100 }],
        ['nothing to pay', { subtotal: 0, cgst: 0, sgst: 0, total: 0 }],
        ['paise in the total', { subtotal: 100.5, total: 105.5 }],
        ['no items', { item_count: 0 }],
        ['a discount without a code', { savings: 10 }],
        ['a code without a discount', { discount_code: 'TEN' }],
        ['half a refund', { refunded_at: '2031-01-01T05:00:00Z', refund_amount: 50, refund_reason: 'x' }],
      ];
      for (const [why, over] of bad) await expect(raw(over), why).rejects.toThrow();
    });

    it('a saved bill cannot be edited: dishes, amounts, number, day, type and payment type are locked', async () => {
      const o = await place('lock-order-1', 'cash');
      const edits = [
        'total = total + 1',
        'subtotal = 1, cgst = 0, sgst = 0, total = 1',
        "lines = '[]'::jsonb",
        'item_count = 99',
        "token = '999'",
        "token_day = '2020-01-01'",
        "pay_method = 'upi'",
        "type = 'dine_in'",
        "idempotency_key = 'another'",
        "savings = 5, discount_code = 'X', subtotal = subtotal - 5, total = total - 5",
        "created_at = now() - interval '1 day'",
      ];
      for (const set of edits)
        await expect(db.query('update orders set ' + set + ' where id = $1', [o.id]), set).rejects.toThrow(
          /cannot be changed/,
        );
      // what may change: the name and phone, and the state along the allowed moves
      await db.query("update orders set customer_name = 'Asha', customer_phone = null where id = $1", [o.id]);
      const now = (
        await db.query<{ total: string; customer_name: string }>('select * from orders where id = $1', [o.id])
      ).rows[0];
      expect(now.customer_name).toBe('Asha');
      expect(now.total).toBe(o.total);
    });

    it('allows exactly the status moves the app allows (every pair), and nothing else', async () => {
      const PATH: Record<OrderStatus, OrderStatus[]> = {
        pending_payment: [],
        awaiting_cash: ['awaiting_cash'],
        new: ['new'],
        cooking: ['new', 'cooking'],
        ready: ['new', 'cooking', 'ready'],
        handed_over: ['new', 'cooking', 'ready', 'handed_over'],
        cancelled: ['cancelled'],
      };
      let n = 0;
      for (const from of ALL)
        for (const to of ALL) {
          if (from === to) continue;
          n += 1;
          const o = await place('state-pair-' + n, 'upi');
          for (const step of PATH[from]) await db.query('update orders set status = $2 where id = $1', [o.id, step]);
          const move = db.query('update orders set status = $2 where id = $1', [o.id, to]);
          if (canMove(from, to)) await move;
          else await expect(move, from + ' to ' + to).rejects.toThrow(/cannot go from/);
        }
    });

    it('a payment time and a refund are written once; only a paid order can be refunded', async () => {
      const o = await place('pay-once-1', 'cash');
      const refund = "refunded_at = now(), refund_reason = 'Wrong order', refund_amount = total";
      await expect(db.query('update orders set ' + refund + ' where id = $1', [o.id])).rejects.toThrow(/not paid/);
      await db.query("update orders set status = 'new', paid_at = now() where id = $1", [o.id]);
      await expect(
        db.query("update orders set paid_at = now() + interval '1 hour' where id = $1", [o.id]),
      ).rejects.toThrow(/payment time/);
      await expect(db.query('update orders set paid_at = null where id = $1', [o.id])).rejects.toThrow(/payment time/);
      await expect(
        db.query("update orders set refunded_at = now(), refund_reason = 'x', refund_amount = 1 where id = $1", [o.id]),
      ).rejects.toThrow(); // a refund is the whole bill
      await db.query('update orders set ' + refund + ' where id = $1', [o.id]);
      await expect(
        db.query("update orders set refund_reason = 'changed my mind' where id = $1", [o.id]),
      ).rejects.toThrow(/already recorded/);
      await expect(
        db.query('update orders set refunded_at = null, refund_amount = null, refund_reason = null where id = $1', [
          o.id,
        ]),
      ).rejects.toThrow(/already recorded/);
    });

    it('logs every change of state by itself, in order', async () => {
      const o = await place('log-order-1', 'upi');
      for (const to of ['awaiting_cash', 'new', 'cooking', 'ready', 'handed_over'])
        await db.query('update orders set status = $2 where id = $1', [o.id, to]);
      await db.query("update orders set customer_name = 'no event for this' where id = $1", [o.id]);
      await db.query(
        "update orders set refunded_at = now(), refund_reason = 'Food issue', refund_amount = total where id = $1",
        [o.id],
      );
      const log = (
        await db.query<{ kind: string; from_status: string | null; to_status: string | null; note: string | null }>(
          'select kind, from_status, to_status, note from order_events where order_id = $1 order by id',
          [o.id],
        )
      ).rows;
      expect(log.map((e) => e.kind + ':' + (e.from_status ?? '') + '>' + (e.to_status ?? ''))).toEqual([
        'placed:>pending_payment',
        'status:pending_payment>awaiting_cash',
        'status:awaiting_cash>new',
        'status:new>cooking',
        'status:cooking>ready',
        'status:ready>handed_over',
        'refund:>',
      ]);
      expect(log[6].note).toBe('₹' + Number(o.total) + ' · Food issue');
      const priv = await db.query<{ rls: boolean; a: boolean }>(
        "select (select relrowsecurity from pg_class where relname = 'order_events') rls, has_function_privilege('anon', 'orders_log()', 'execute') a",
      );
      expect(priv.rows[0]).toEqual({ rls: true, a: false });
    });
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
