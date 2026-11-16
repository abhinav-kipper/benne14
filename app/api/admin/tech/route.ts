import { adminDenied } from '@/lib/admin';
import { MIGRATIONS } from '@/lib/migrations';
import { fail, json } from '@/lib/server';
import { getStore } from '@/lib/store';
import { groupErrors, moneyAndKitchen, speeds, type TechReport } from '@/lib/tech';
import { systemReport } from '@/lib/watch';

export const dynamic = 'force-dynamic';

// The owner app's technical page: speed of the important steps, errors grouped, stuck money and
// kitchen pace, database size. Everything the "Copy report" button copies comes from here.
// No secrets and no customer details.
export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const store = getStore();
    const [sys, timings, errors, live, today, db, applied] = await Promise.all([
      systemReport(store),
      store.listTimings(),
      store.listErrors(500),
      store.listLive(),
      store.listToday(),
      store.dbStats(),
      store.appliedMigrations(),
    ]);
    const now = Date.parse(sys.now);
    const report: TechReport = {
      now: sys.now,
      build: sys.build,
      store: sys.store,
      payments: sys.payments,
      testMode: sys.testMode,
      migrations: {
        applied: applied.length,
        missing: MIGRATIONS.filter((m) => !applied.includes(m) && (applied.length > 0 || m >= '0004')),
      },
      speed: speeds(timings, now),
      errors: groupErrors(errors),
      ...moneyAndKitchen(live, today, now),
      ordersToday: today.length,
      devices: sys.devices,
      problems: sys.problems,
      db,
    };
    return json(report);
  } catch (e) {
    return fail(e);
  }
}
