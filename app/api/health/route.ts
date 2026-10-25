import { getStore, keyKind } from '@/lib/store';
import { json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Setup check: is the database reachable, which key type is set, is the staff PIN set. Never returns secrets.
export async function GET() {
  const out: Record<string, unknown> = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'missing',
    supabaseKey: keyKind(),
    staffPin: process.env.STAFF_PIN ? 'set' : 'missing',
    payments: process.env.PAYMENTS ?? 'mock',
  };
  try {
    const store = getStore();
    out.store = store.kind;
    out.liveOrders = (await store.listLive()).length;
    out.database = 'ok';
  } catch (e) {
    out.database = e instanceof Error ? e.message : 'error';
  }
  const ok = out.database === 'ok' && out.staffPin === 'set';
  return json({ ok, ...out }, ok ? 200 : 503);
}
