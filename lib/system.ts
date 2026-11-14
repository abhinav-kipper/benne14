// What the owner app's System page says: is every screen alive, is anything wrong. Pure, so the
// rules can be tested without a clock or a database.
export const DEVICE_KINDS = ['kiosk', 'kitchen', 'board', 'owner'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export const ERROR_SOURCES = [...DEVICE_KINDS, 'bill', 'server'] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];

export interface Device {
  id: string;
  kind: DeviceKind;
  screen: string | null;
  build: string | null;
  firstSeen: string;
  seenAt: string;
}
export interface ErrorEntry {
  at: string;
  source: ErrorSource;
  message: string;
  detail: string | null;
  build: string | null;
  device: string | null;
}
export interface Problem {
  key: string; // the same problem keeps the same key from one check to the next
  level: 'bad' | 'warn' | 'info'; // bad: orders may be affected now; warn: look soon; info: good to know
  text: string;
  hint?: string; // what to do about it
}

export const BEAT_MS = 30_000; // how often a screen says "I'm here"
export const QUIET_MS = 2 * 60_000; // no word for this long = that screen is off, asleep or offline
export const FORGET_MS = 14 * 24 * 3600_000; // a screen not seen for two weeks is gone (replaced tablet)
const KIND_NAME: Record<DeviceKind, string> = {
  kiosk: 'Kiosk',
  kitchen: 'Kitchen screen',
  board: 'TV board',
  owner: 'Owner app',
};
export const kindName = (k: DeviceKind) => KIND_NAME[k];
export const isDeviceId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{8,24}$/.test(v);

const mins = (ms: number) => Math.max(1, Math.round(ms / 60_000));
export const ago = (iso: string, now: number) => {
  const ms = now - Date.parse(iso);
  if (ms < 60_000) return 'just now';
  if (ms < 3600_000) return `${mins(ms)} min ago`;
  if (ms < 48 * 3600_000) return `${Math.round(ms / 3600_000)} h ago`;
  return `${Math.round(ms / (24 * 3600_000))} days ago`;
};
export const isOnline = (d: Pick<Device, 'seenAt'>, now: number) => now - Date.parse(d.seenAt) < QUIET_MS;

export interface SystemInput {
  now: number;
  open: boolean; // is the shop open right now? A silent kiosk at 3 am is not a problem.
  build: string; // the version the server is running
  devices: Device[];
  errors: ErrorEntry[]; // newest first
  missingMigrations: string[];
  testMode: boolean;
  payments: { at: string; subject: string; note?: string | null }[]; // payments flagged for a look
  ownerPinSet?: boolean; // does the owner app have its own PIN yet?
}

// Everything that needs the owner's eye, worst first.
export function problems(s: SystemInput): Problem[] {
  const out: Problem[] = [];
  for (const kind of ['kiosk', 'kitchen', 'board'] as const) {
    const mine = s.devices.filter((d) => d.kind === kind);
    if (!mine.length) continue; // never connected: the page shows that itself, it is not a fault
    const live = mine.filter((d) => isOnline(d, s.now));
    if (!live.length && s.open) {
      const last = mine.reduce((a, d) => (d.seenAt > a ? d.seenAt : a), mine[0].seenAt);
      out.push({
        key: `silent:${kind}`,
        level: kind === 'board' ? 'warn' : 'bad',
        text: `${KIND_NAME[kind]} has been silent since ${ago(last, s.now)}`,
        hint:
          kind === 'kiosk'
            ? 'Customers cannot order on it. Check it is on, awake and on Wi-Fi.'
            : kind === 'kitchen'
              ? 'The cook is not seeing new orders. Check the tablet, or open the kitchen screen on a phone.'
              : 'Customers cannot see their number. Check the TV and its Wi-Fi.',
      });
    }
    // on a version from before the last update, ten minutes after it should have reloaded itself
    const stale = live.filter((d) => d.build && d.build !== s.build && s.now - Date.parse(d.firstSeen) > 10 * 60_000);
    if (stale.length)
      out.push({
        key: `old:${kind}`,
        level: 'warn',
        text: `${KIND_NAME[kind]} is on an old version`,
        hint: 'Hold the logo on that screen for five seconds to restart it.',
      });
  }
  const recent = s.errors.filter((e) => s.now - Date.parse(e.at) < 15 * 60_000);
  if (recent.length >= 3)
    out.push({
      key: 'errors',
      level: recent.some((e) => e.source === 'server') ? 'bad' : 'warn',
      text: `${recent.length} errors in the last 15 minutes`,
      hint: 'See the list below. If orders are failing, take them at the counter.',
    });
  for (const p of s.payments.filter((p) => s.now - Date.parse(p.at) < 24 * 3600_000))
    out.push({
      key: `pay:${p.at}`,
      level: 'bad',
      text: `Payment needs a look: ${p.subject}`,
      hint: p.note ?? undefined,
    });
  if (s.missingMigrations.length)
    out.push({
      key: 'migrations',
      level: 'warn',
      text: 'A database update has not been run',
      hint: `Run in Supabase: ${s.missingMigrations.join(', ')}`,
    });
  if (s.ownerPinSet === false)
    out.push({
      key: 'ownerpin',
      level: 'warn',
      text: 'The owner app still opens with the kitchen’s PIN',
      hint: 'Set OWNER_PIN (six digits) in Vercel and redeploy. Kitchen staff then cannot see takings or change prices.',
    });
  if (s.testMode)
    out.push({
      key: 'test',
      level: 'info',
      text: 'Test mode is on',
      hint: 'Cash counts as paid by itself. Turn it off before real customers.',
    });
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// Text a screen sends when it reports an error: short, printable, and never a place for long data.
export const clip = (v: unknown, max: number): string =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

// Which problems are worth waking the owner's phone for: anything that may be losing orders or
// money now, and any shop screen gone silent. A stale version or test mode can wait for a look.
export const worthAPush = (p: Problem) => p.level === 'bad' || p.key.startsWith('silent:');

export interface Alert {
  key: string;
  level: Problem['level'];
  text: string;
  hint: string | null;
  firstAt: string;
  clearedAt: string | null;
}
// What changed since the last check: problems that are new, and alerts whose problem has gone.
export function alertChanges(now: Problem[], open: Pick<Alert, 'key'>[]) {
  const was = new Set(open.map((a) => a.key));
  const is = new Set(now.map((p) => p.key));
  return { fresh: now.filter((p) => !was.has(p.key)), gone: open.filter((a) => !is.has(a.key)).map((a) => a.key) };
}

// Where a browser's push messages are sent. Only the real push services (and a reserved test name):
// the server will post to this address, so it must never be one somebody made up.
export function isPushEndpoint(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 1000) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  const h = u.hostname;
  return (
    u.protocol === 'https:' &&
    (h === 'fcm.googleapis.com' ||
      h === 'updates.push.services.mozilla.com' ||
      h === 'web.push.apple.com' ||
      h.endsWith('.push.apple.com') ||
      h.endsWith('.notify.windows.com') ||
      h.endsWith('.push.invalid'))
  );
}
