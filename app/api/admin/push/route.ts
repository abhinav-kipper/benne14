import { adminDenied } from '@/lib/admin';
import { pushToAll, vapid } from '@/lib/push';
import { fail, json, readJson } from '@/lib/server';
import { getStore } from '@/lib/store';
import { isPushEndpoint } from '@/lib/system';

export const dynamic = 'force-dynamic';

const b64url = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 10 && v.length <= max && /^[A-Za-z0-9_-]+=*$/.test(v);

// The key a phone needs to subscribe, and how many phones already have.
export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const store = getStore();
    return json({ publicKey: (await vapid(store)).publicKey, phones: (await store.listSubs()).length });
  } catch (e) {
    return fail(e);
  }
}

// { subscribe: { endpoint, keys: { p256dh, auth } } }  this phone wants notifications
// { unsubscribe: endpoint }                            this phone no longer does
// { test: true }                                       send "This is a test" to every phone
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const b = await readJson(req);
    const store = getStore();
    if (b.subscribe !== undefined) {
      const s = (b.subscribe ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
      if (!isPushEndpoint(s.endpoint) || !b64url(s.keys?.p256dh, 200) || !b64url(s.keys?.auth, 100))
        return json({ error: 'This browser’s notification details were not understood' }, 400);
      await store.saveSub({ endpoint: s.endpoint, p256dh: s.keys!.p256dh as string, auth: s.keys!.auth as string });
      return json({ phones: (await store.listSubs()).length });
    }
    if (b.unsubscribe !== undefined) {
      if (typeof b.unsubscribe !== 'string') return json({ error: 'Bad request' }, 400);
      await store.dropSub(b.unsubscribe);
      return json({ phones: (await store.listSubs()).length });
    }
    if (b.test === true) {
      const sent = await pushToAll(store, {
        title: 'benne 14: this is a test',
        body: 'Notifications are working on this phone.',
        tag: 'test',
      });
      return json({ sent });
    }
    return json({ error: 'Nothing to do' }, 400);
  } catch (e) {
    return fail(e);
  }
}
