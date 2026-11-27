import { settle } from '@/lib/gateway';
import { instaCollectConfig, orderOfWebhook, signedOrderWebhook } from '@/lib/instacollect';
import { json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Easebuzz calls this when an InstaCollect order changes (set the URL in the Easebuzz dashboard for
// the InstaCollect order events: ORDER_STATUS_UPDATE is the one that matters, ORDER_CREATED is
// accepted and ignored). Open on purpose: Easebuzz cannot send a PIN. The body must carry Easebuzz's
// signature; even then it is only a hint: the order is marked paid by lib/gateway.ts after asking
// Easebuzz directly. Other InstaCollect events (a credit to a QR that is not one of our orders, a
// settlement) are answered 200 and left alone.
export async function POST(req: Request) {
  const cfg = instaCollectConfig();
  if (!cfg) return json({ error: 'InstaCollect is not configured' }, 503);
  let body: { event?: unknown; data?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json({ error: 'Bad body' }, 400);
  }
  const d = body && typeof body.data === 'object' && body.data ? (body.data as Record<string, unknown>) : null;
  if (!d) return json({ error: 'Bad body' }, 400);
  if (body.event !== 'ORDER_STATUS_UPDATE' && body.event !== 'ORDER_CREATED')
    return json({ ok: true, ignored: 'not an order event' });
  if (!signedOrderWebhook(cfg, d)) return json({ error: 'Bad signature' }, 400);
  const orderId = orderOfWebhook(d);
  if (!orderId) return json({ ok: true, ignored: 'not one of our orders' });
  if (body.event === 'ORDER_CREATED') return json({ ok: true });
  try {
    const r = await settle(orderId);
    return json({ ok: true, state: r?.state ?? 'unknown order' });
  } catch (e) {
    console.error('InstaCollect webhook could not be settled', e);
    return json({ error: 'Try again' }, 500);
  }
}
