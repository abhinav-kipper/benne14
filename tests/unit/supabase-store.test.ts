import { describe, expect, it } from 'vitest';
import { supabaseStore } from '@/lib/store/supabase';
import type { Store } from '@/lib/store';

// The Supabase store is assembled from one file per area. The real behaviour is tested against a
// real Postgres in CI (tests/integration); this only proves the assembly: every method reaches the
// database client it was given, with its arguments in place.
describe('supabase store assembly', () => {
  const calls: string[] = [];
  const fake: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const store: Store = supabaseStore('http://db.test', 'key', fake);

  it('says what it is', () => {
    expect(store.kind).toBe('supabase');
  });

  it('sends each call to the table it belongs to, with its arguments', async () => {
    expect(await store.listEvents(7)).toEqual([]);
    expect(calls.at(-1)).toContain('/rest/v1/admin_events');
    expect(calls.at(-1)).toContain('limit=7');
    expect(await store.listCodes()).toEqual([]);
    expect(calls.at(-1)).toContain('/rest/v1/discount_codes');
    expect(await store.appliedMigrations()).toEqual([]);
    expect(calls.at(-1)).toContain('/rest/v1/schema_migrations');
  });

  it('lets one area call another (a read used by a write)', async () => {
    await expect(store.setStatus('00000000-0000-4000-8000-000000000000', 'cooking')).rejects.toMatchObject({
      status: 404,
    });
    expect(calls.at(-1)).toContain('/rest/v1/orders');
  });
});
