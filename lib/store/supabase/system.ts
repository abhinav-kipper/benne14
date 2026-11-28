// Watching the system: screens' heartbeats, errors, phone subscriptions, alerts, stored keys, migrations.
import type { PushSub } from '../index';
import { FORGET_MS, type Alert, type Device, type DeviceKind, type ErrorEntry } from '../../system';
import type { DbStats, Timing } from '../../tech';
import { MAX_DEVICES, MAX_ERRORS, MAX_SUBS, MAX_TIMINGS, StoreError, sortAlerts } from '../memory';
import { missing, noColumn, storeError, type Db } from './shared';

// None of these may ever throw into a screen: a failed "I'm here" or a failed error report is
// dropped (and before migration 0012 they simply do nothing).
export async function beat(db: Db, d: { id: string; kind: DeviceKind; screen: string | null; build: string | null }) {
  const now = new Date().toISOString();
  const upd = await db
    .from('devices')
    .update({ kind: d.kind, screen: d.screen, build: d.build, seen_at: now })
    .eq('id', d.id)
    .select('id');
  if (upd.error || (upd.data as unknown[]).length) return;
  // a screen never seen before: let it in unless the table is full
  const { count } = await db.from('devices').select('id', { count: 'exact', head: true });
  if ((count ?? 0) >= MAX_DEVICES) {
    await db
      .from('devices')
      .delete()
      .lt('seen_at', new Date(Date.now() - FORGET_MS).toISOString());
    return;
  }
  await db.from('devices').insert({ id: d.id, kind: d.kind, screen: d.screen, build: d.build });
}

export async function listDevices(db: Db): Promise<Device[]> {
  const read = (cols: string) =>
    db
      .from('devices')
      .select(cols)
      .gt('seen_at', new Date(Date.now() - FORGET_MS).toISOString())
      .order('seen_at', { ascending: false })
      .limit(MAX_DEVICES);
  let { data, error } = await read('id,kind,screen,build,first_seen,seen_at,shop');
  // before migration 0017 no screen can be picked as the shop's own: list them all, unpicked
  if (noColumn(error)) ({ data, error } = await read('id,kind,screen,build,first_seen,seen_at'));
  if (missing(error)) return [];
  if (error) throw new StoreError(error.message, 500);
  return (
    data as unknown as {
      id: string;
      kind: DeviceKind;
      screen: string | null;
      build: string | null;
      first_seen: string;
      seen_at: string;
      shop?: boolean;
    }[]
  ).map((r) => ({
    id: r.id,
    kind: r.kind,
    screen: r.screen,
    build: r.build,
    firstSeen: r.first_seen,
    seenAt: r.seen_at,
    shop: !!r.shop,
  }));
}

const NEEDS_0017 = 'Run supabase/migrations/0017_shop_screens.sql in Supabase first';
export async function markDevice(db: Db, id: string, shop: boolean) {
  const { data, error } = await db.from('devices').select('id,kind').eq('id', id).maybeSingle();
  if (error) throw new StoreError(error.message, 500);
  if (!data) throw new StoreError('No such screen', 404);
  const kind = (data as unknown as { kind: DeviceKind }).kind;
  // one shop screen of each kind: picking this one lets go of the other
  if (shop) {
    const off = await db.from('devices').update({ shop: false }).eq('kind', kind).neq('id', id);
    if (noColumn(off.error)) throw new StoreError(NEEDS_0017, 503);
    if (off.error) throw new StoreError(off.error.message, 500);
  }
  const set = await db.from('devices').update({ shop }).eq('id', id);
  if (noColumn(set.error)) throw new StoreError(NEEDS_0017, 503);
  if (set.error) throw new StoreError(set.error.message, 500);
}

export async function forgetDevices(db: Db, id: string | null) {
  const q = db.from('devices').delete();
  const { data, error } = await (id ? q.eq('id', id) : q.eq('shop', false)).select('id');
  if (noColumn(error)) throw new StoreError(NEEDS_0017, 503);
  if (error) throw new StoreError(error.message, 500);
  if (id && !(data as unknown[]).length) throw new StoreError('No such screen', 404);
  return (data as unknown[]).length;
}

export async function logError(db: Db, e: Omit<ErrorEntry, 'at'>) {
  const { data, error } = await db
    .from('error_log')
    .insert({ source: e.source, message: e.message, detail: e.detail, build: e.build, device: e.device })
    .select('id')
    .maybeSingle();
  // keep the newest MAX_ERRORS: ids only grow, so everything this far behind the new row goes
  if (!error && data)
    await db
      .from('error_log')
      .delete()
      .lt('id', (data as { id: number }).id - MAX_ERRORS);
}

export async function listErrors(db: Db, limit = 50): Promise<ErrorEntry[]> {
  const { data, error } = await db
    .from('error_log')
    .select('at,source,message,detail,build,device')
    .order('id', { ascending: false })
    .limit(limit);
  if (missing(error)) return [];
  if (error) throw new StoreError(error.message, 500);
  return data as ErrorEntry[];
}

// Alerts to the owner's phone (migration 0013).
export async function listSubs(db: Db): Promise<PushSub[]> {
  const { data, error } = await db.from('push_subs').select('endpoint,p256dh,auth').limit(MAX_SUBS);
  if (missing(error)) return [];
  if (error) throw new StoreError(error.message, 500);
  return data as PushSub[];
}

export async function saveSub(db: Db, s: PushSub) {
  const { count, error: e0 } = await db.from('push_subs').select('endpoint', { count: 'exact', head: true });
  if (missing(e0)) throw new StoreError('Notifications need a database update (migration 0013)', 503);
  if ((count ?? 0) >= MAX_SUBS) throw new StoreError('Too many phones already have notifications on', 409);
  const { error } = await db.from('push_subs').upsert({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
  if (error) throw storeError(error);
}

export async function dropSub(db: Db, endpoint: string) {
  await db.from('push_subs').delete().eq('endpoint', endpoint);
}

export async function openAlert(db: Db, a: Pick<Alert, 'key' | 'level' | 'text' | 'hint'>) {
  const row = {
    key: a.key,
    level: a.level,
    text: a.text,
    hint: a.hint,
    first_at: new Date().toISOString(),
    cleared_at: null,
  };
  // a problem never seen before: the insert succeeds for exactly one caller
  const ins = await db.from('alerts').insert(row).select('key');
  if (!ins.error) return true;
  if (ins.error.code !== '23505') return false; // table missing or unreachable: no alert, no notification
  // seen before: reopen it only if it had been cleared (again, one caller wins)
  const upd = await db.from('alerts').update(row).eq('key', a.key).not('cleared_at', 'is', null).select('key');
  return !upd.error && (upd.data as unknown[]).length > 0;
}

export async function clearAlerts(db: Db, keys: string[]) {
  if (!keys.length) return;
  await db.from('alerts').update({ cleared_at: new Date().toISOString() }).in('key', keys).is('cleared_at', null);
}

export async function listAlerts(db: Db, limit = 30): Promise<Alert[]> {
  const { data, error } = await db
    .from('alerts')
    .select('key,level,text,hint,first_at,cleared_at')
    .order('first_at', { ascending: false })
    .limit(200);
  if (missing(error)) return [];
  if (error) throw new StoreError(error.message, 500);
  return sortAlerts(
    (
      data as {
        key: string;
        level: Alert['level'];
        text: string;
        hint: string | null;
        first_at: string;
        cleared_at: string | null;
      }[]
    ).map((r) => ({
      key: r.key,
      level: r.level,
      text: r.text,
      hint: r.hint,
      firstAt: r.first_at,
      clearedAt: r.cleared_at,
    })),
  ).slice(0, limit);
}

export async function getKey(db: Db, name: string) {
  const { data, error } = await db.from('app_keys').select('value').eq('name', name).maybeSingle();
  if (error) return null;
  return (data as { value: string } | null)?.value ?? null;
}

export async function setKeyOnce(db: Db, name: string, value: string) {
  const ins = await db.from('app_keys').insert({ name, value });
  if (ins.error && ins.error.code !== '23505') {
    if (missing(ins.error)) throw new StoreError('Notifications need a database update (migration 0013)', 503);
    throw storeError(ins.error);
  }
  return (await getKey(db, name)) ?? value;
}

export async function appliedMigrations(db: Db) {
  const { data, error } = await db.from('schema_migrations').select('name');
  if (error) return []; // the table arrives with migration 0004
  return (data as { name: string }[]).map((r) => r.name);
}

// The technical page. A timing that cannot be saved is dropped: measuring must never fail a request.
export async function logTiming(db: Db, t: Omit<Timing, 'at'>) {
  const { data, error } = await db
    .from('timings')
    .insert({ op: t.op, ms: t.ms, ok: t.ok, build: t.build })
    .select('id')
    .maybeSingle();
  // keep the newest MAX_TIMINGS: ids only grow, so everything this far behind the new row goes
  if (!error && data && (data as { id: number }).id % 50 === 0)
    await db
      .from('timings')
      .delete()
      .lt('id', (data as { id: number }).id - MAX_TIMINGS);
}

export async function listTimings(db: Db, limit = MAX_TIMINGS): Promise<Timing[]> {
  const out: Timing[] = [];
  // Supabase returns at most 1000 rows per request: page through.
  for (let from = 0; from < limit; from += 1000) {
    const { data, error } = await db
      .from('timings')
      .select('at,op,ms,ok,build')
      .order('id', { ascending: false })
      .range(from, Math.min(limit, from + 1000) - 1);
    if (missing(error)) return [];
    if (error) throw new StoreError(error.message, 500);
    out.push(...(data as Timing[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export async function dbStats(db: Db): Promise<DbStats> {
  const { data, error } = await db.rpc('db_stats');
  // before migration 0014 there is no such function: size unknown, nothing counted
  if (error || !data) return { bytes: null, rows: {}, firstOrder: null };
  const { bytes, first_order, ...rows } = data as { bytes: number; first_order: string | null } & Record<
    string,
    number
  >;
  return { bytes: Number(bytes), rows, firstOrder: first_order ?? null };
}
