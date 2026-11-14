// Sending a notification to the phones that asked for one (owner app → System → Turn on
// notifications). Web Push: the browser's own push service delivers it; nothing else is involved.
import 'server-only';
import webpush from 'web-push';
import type { Store } from './store';

export interface PushMessage {
  title: string;
  body: string;
  tag: string; // a later message with the same tag replaces the earlier one on the phone
}

// The key pair that signs every notification (VAPID). Made on first use and kept in the database,
// where only the server can read it, so nothing has to be generated or pasted by hand. The public
// half is what a phone is given when it subscribes.
const KEY = 'vapid';
const cached = new WeakMap<Store, { publicKey: string; privateKey: string }>(); // per store: read once per server
export async function vapid(store: Store) {
  const have = cached.get(store);
  if (have) return have;
  let v = await store.getKey(KEY);
  if (!v) v = await store.setKeyOnce(KEY, JSON.stringify(webpush.generateVAPIDKeys()));
  const k = JSON.parse(v) as { publicKey: string; privateKey: string };
  const keys = { publicKey: k.publicKey, privateKey: k.privateKey };
  cached.set(store, keys);
  return keys;
}

// Send to every subscribed phone. Returns how many were handed to a push service. A phone that
// has switched notifications off (the service answers 404 or 410) is forgotten.
export async function pushToAll(store: Store, m: PushMessage): Promise<number> {
  const subs = await store.listSubs();
  if (!subs.length) return 0;
  const keys = await vapid(store);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      // ".push.invalid" can never be a real service (the name is reserved): the tests' phones
      if (new URL(s.endpoint).hostname.endsWith('.push.invalid')) {
        sent++;
        return;
      }
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(m),
          {
            vapidDetails: { subject: 'https://benne14.app', publicKey: keys.publicKey, privateKey: keys.privateKey },
            TTL: 3600, // an alert that could not be delivered within the hour is stale
            urgency: 'high',
            timeout: 8000,
          },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await store.dropSub(s.endpoint);
        else console.error('push failed', code ?? (e instanceof Error ? e.message : e));
      }
    }),
  );
  return sent;
}
