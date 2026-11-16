// Supabase-backed store. Server only: uses the service role key; tables have RLS with no public policies.
// One file per area (orders, menu, events, offers, system); each exports plain functions that take
// the database client first. This file gives them the client and presents them as one Store.
import { createClient } from '@supabase/supabase-js';
import type { Store } from '../index';
import * as events from './events';
import * as menu from './menu';
import * as offers from './offers';
import * as orders from './orders';
import { DB_TIMEOUT_MS, type Db } from './shared';
import * as system from './system';

// (db, ...args) => result  becomes  (...args) => result
type Bound<T> = { [K in keyof T]: T[K] extends (db: Db, ...args: infer A) => infer R ? (...args: A) => R : never };
function bind<T extends object>(db: Db, fns: T): Bound<T> {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(fns))
    out[name] = (...args: unknown[]) => (fn as (db: Db, ...args: unknown[]) => unknown)(db, ...args);
  return out as Bound<T>;
}

// `fetchImpl` is for the integration tests, which point the client at a bare PostgREST.
export function supabaseStore(url: string, serviceKey: string, fetchImpl?: typeof fetch): Store {
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false },
    // A database that stops answering must fail the request quickly (the kiosk then sends
    // customers to the counter) instead of holding it until the platform gives up.
    global: {
      fetch:
        fetchImpl ??
        ((input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(DB_TIMEOUT_MS) })),
    },
  });
  return {
    kind: 'supabase',
    ...bind(db, orders),
    ...bind(db, menu),
    ...bind(db, events),
    ...bind(db, offers),
    ...bind(db, system),
  };
}
