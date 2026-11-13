import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { priceOrder } from '@/lib/pricing';

// Runs the real migrations in an in-memory Postgres (PGlite), so the SQL that runs in Supabase
// (place_order: daily numbers, idempotency, first status) is tested, not just the app around it.
const dir = path.resolve(__dirname, '../../supabase/migrations');
const priced = JSON.stringify(priceOrder([{ itemId: 'masala-dosa', qty: 2, choices: { dosaExtras: ['benne'] }, notes: ['less-oil'] }]));

let db: PGlite;
const place = async (key: string, pay = 'upi', name = 'Rahul') =>
  (await db.query<{ id: string; token: string; status: string; total: string; customer_name: string | null; lines: unknown }>(
    'select * from place_order($1, $2, $3, $4, $5::jsonb)', [key, 'takeaway', name, pay, priced])).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated;'); // Supabase's built-in roles
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join(dir, f), 'utf8'));
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
    const today = (await db.query<{ d: string }>("select ((now() at time zone 'Asia/Kolkata')::date)::text d")).rows[0].d;
    await db.query("insert into token_counters values ((now() at time zone 'Asia/Kolkata')::date - 1, 500)");
    const t = await place('db-day');
    expect(Number(t.token)).toBeLessThan(500);
    const yesterday = (await db.query<{ last: number }>("select last from token_counters where day < $1::date", [today])).rows[0];
    expect(yesterday.last).toBe(500);
  });

  it('refuses bad rows (unknown status or payment type)', async () => {
    await expect(db.query("update orders set status = 'eaten' where token = '1'")).rejects.toThrow();
    await expect(db.query("select place_order('db-bad', 'takeaway', '', 'bitcoin', $1::jsonb)", [priced])).rejects.toThrow();
  });

  it('keeps orders private: RLS on, and the public roles cannot call place_order', async () => {
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relname in ('orders', 'token_counters')");
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
    const can = await db.query<{ anon: boolean; auth: boolean }>(
      "select has_function_privilege('anon', 'place_order(text,text,text,text,jsonb)', 'execute') anon, has_function_privilege('authenticated', 'place_order(text,text,text,text,jsonb)', 'execute') auth");
    expect(can.rows[0]).toEqual({ anon: false, auth: false });
  });
});
