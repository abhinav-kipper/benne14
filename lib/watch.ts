// The check behind the owner app's System page and the alerts on the owner's phone: gather what
// the shop's screens and the server have reported, work out what is wrong (lib/system.ts), and
// tell the phones about anything new.
import 'server-only';
import { MIGRATIONS } from './migrations';
import { istHour } from './orders';
import { pushToAll } from './push';
import { ownerPin, paymentMode } from './server';
import { SHOP } from './shop';
import type { Store } from './store';
import { alertChanges, problems, worthAPush } from './system';
import { isTestMode } from './testmode';
import { BUILD_ID } from './version';

export async function systemReport(store: Store) {
  const [devices, errors, applied, events, alerts, subs] = await Promise.all([
    store.listDevices(),
    store.listErrors(40),
    store.appliedMigrations(),
    store.listEvents(100),
    store.listAlerts(30),
    store.listSubs(),
  ]);
  const now = Date.now();
  const hour = istHour(new Date(now).toISOString());
  const missing = MIGRATIONS.filter((m) => !applied.includes(m) && (applied.length > 0 || m >= '0004'));
  const testMode = isTestMode();
  return {
    now: new Date(now).toISOString(),
    build: BUILD_ID,
    store: store.kind,
    payments: paymentMode(),
    testMode,
    devices,
    errors,
    alerts,
    phones: subs.length, // how many phones have notifications on
    problems: problems({
      now,
      open: hour >= SHOP.hours.open && hour < SHOP.hours.close,
      build: BUILD_ID,
      devices,
      errors,
      missingMigrations: missing,
      testMode,
      ownerPinSet: !!ownerPin(),
      fssaiFeePaidUpto: SHOP.fssai.feePaidUpto,
      payments: events
        .filter((e) => e.kind === 'payment')
        .map((e) => ({ at: e.at, subject: e.subject, note: e.note ?? e.after })),
    }),
  };
}

// Compare what is wrong now with the alerts already open: announce what is new, close what has
// gone. Each problem is announced once, by whichever server opens its alert first.
export async function watch(store: Store): Promise<{ fresh: number; gone: number; pushed: number }> {
  const [report, open] = await Promise.all([systemReport(store), store.listAlerts(200)]);
  const notable = report.problems.filter(worthAPush);
  const { fresh, gone } = alertChanges(
    notable,
    open.filter((a) => !a.clearedAt),
  );
  let pushed = 0;
  for (const p of fresh) {
    if (!(await store.openAlert({ key: p.key, level: p.level, text: p.text, hint: p.hint ?? null }))) continue;
    pushed += await pushToAll(store, { title: p.text, body: p.hint ?? 'Open the owner app to see more.', tag: p.key });
  }
  await store.clearAlerts(gone);
  return { fresh: fresh.length, gone: gone.length, pushed };
}

// Called from requests the shop's screens make anyway (the kitchen and TV ask for orders every
// couple of seconds): run the check at most once a minute per server, after the reply has gone out.
const EVERY_MS = 60_000;
let last = 0;
export function watchIsDue(now = Date.now()): boolean {
  if (now - last < EVERY_MS) return false;
  last = now;
  return true;
}
export async function watchQuietly(store: Store) {
  try {
    await watch(store);
  } catch (e) {
    console.error('system watch failed', e instanceof Error ? e.message : e); // tried again next minute
  }
}
