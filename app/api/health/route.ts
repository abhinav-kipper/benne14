import { getStore, keyKind } from '@/lib/store';
import { json, paymentMode } from '@/lib/server';
import { isTestMode } from '@/lib/testmode';
import { MIGRATIONS } from '@/lib/migrations';
import { BUILD_ID } from '@/lib/version';

export const dynamic = 'force-dynamic';

// Setup check: is the database reachable, which key type is set, is the staff PIN set. Never returns secrets.
export async function GET() {
  const out: Record<string, unknown> = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'missing',
    supabaseKey: keyKind(),
    staffPin: process.env.STAFF_PIN ? 'set' : 'missing',
    payments: paymentMode(),
    testMode: isTestMode() ? 'on: cash counts as paid' : 'off',
    build: BUILD_ID.slice(0, 12),
  };
  try {
    const store = getStore();
    out.store = store.kind;
    out.liveOrders = (await store.listLive()).length;
    out.database = 'ok';
    // Informational: which SQL files still need running in Supabase (see lib/migrations.ts).
    const applied = await store.appliedMigrations();
    // The log table arrives with 0004; before that nothing is recorded, though 0001–0003 were run by hand.
    const missing = MIGRATIONS.filter((m) => !applied.includes(m) && (applied.length > 0 || m >= '0004'));
    out.migrations = missing.length ? `to run: ${missing.join(', ')}` : 'ok';
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
