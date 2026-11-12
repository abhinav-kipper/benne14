import { getStore, keyKind } from '@/lib/store';
import { json, paymentMode } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Setup check: is the database reachable, which key type is set, is the staff PIN set. Never returns secrets.
export async function GET() {
  const out: Record<string, unknown> = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'missing',
    supabaseKey: keyKind(),
    staffPin: process.env.STAFF_PIN ? 'set' : 'missing',
    payments: paymentMode(),
  };
  try {
    const store = getStore();
    out.store = store.kind;
    out.liveOrders = (await store.listLive()).length;
    out.database = 'ok';
  } catch (e) {
    out.database = e instanceof Error ? e.message : 'error';
  }
  // The project URL is public (it ships to browsers), so show its host and probe it directly to
  // turn a bare "fetch failed" into something actionable (DNS, TLS, paused project, wrong path).
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (raw) {
    try {
      const u = new URL(raw);
      out.supabaseHost = u.host + (u.pathname !== '/' ? ` (extra path "${u.pathname}" should be removed)` : '');
      const r = await fetch(`${u.origin}/auth/v1/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      out.supabaseReachable = `HTTP ${r.status}`;
    } catch (e) {
      const c = (e as { cause?: { code?: string; message?: string } }).cause;
      out.supabaseReachable = `no: ${c?.code ?? c?.message ?? (e instanceof Error ? e.message : 'error')}`;
    }
  }
  const ok = out.database === 'ok' && out.staffPin === 'set';
  return json({ ok, ...out }, ok ? 200 : 503);
}
