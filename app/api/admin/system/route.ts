import { adminDenied } from '@/lib/admin';
import { MIGRATIONS } from '@/lib/migrations';
import { istHour } from '@/lib/orders';
import { fail, json, paymentMode } from '@/lib/server';
import { SHOP } from '@/lib/shop';
import { getStore } from '@/lib/store';
import { problems } from '@/lib/system';
import { isTestMode } from '@/lib/testmode';
import { BUILD_ID } from '@/lib/version';

export const dynamic = 'force-dynamic';

// The owner app's System page: every screen and when it was last heard from, what needs a look,
// and the latest errors.
export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const store = getStore();
    const [devices, errors, applied, events] = await Promise.all([
      store.listDevices(),
      store.listErrors(40),
      store.appliedMigrations(),
      store.listEvents(100),
    ]);
    const now = Date.now();
    const hour = istHour(new Date(now).toISOString());
    const missing = MIGRATIONS.filter((m) => !applied.includes(m) && (applied.length > 0 || m >= '0004'));
    const testMode = isTestMode();
    return json({
      now: new Date(now).toISOString(),
      build: BUILD_ID,
      store: store.kind,
      payments: paymentMode(),
      testMode,
      devices,
      errors,
      problems: problems({
        now,
        open: hour >= SHOP.hours.open && hour < SHOP.hours.close,
        build: BUILD_ID,
        devices,
        errors,
        missingMigrations: missing,
        testMode,
        payments: events
          .filter((e) => e.kind === 'payment')
          .map((e) => ({ at: e.at, subject: e.subject, note: e.note ?? e.after })),
      }),
    });
  } catch (e) {
    return fail(e);
  }
}
