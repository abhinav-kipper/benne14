import { easebuzzConfig, orderIdOf, signedByEasebuzz } from '@/lib/easebuzz';
import { settle } from '@/lib/gateway';
import { json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Easebuzz calls this when a payment succeeds or fails (set the URL in the Easebuzz dashboard:
// Payment Gateway → Account Settings → Webhooks → Transaction webhook).
// The body is a form. It must carry Easebuzz's signature; even then it is only a hint: the order is
// marked paid by lib/gateway.ts after asking Easebuzz directly.
// Easebuzz retries anything but a 200 (5 times, 30 minutes apart), so problems on our side answer 500
// and a message we will never accept answers 200/400 without a retry storm.
export async function POST(req: Request) {
  const cfg = easebuzzConfig();
  if (!cfg) return json({ error: 'Easebuzz is not configured' }, 503);
  let form: Record<string, string>;
  try {
    form = Object.fromEntries(new URLSearchParams(await req.text()));
  } catch {
    return json({ error: 'Bad body' }, 400);
  }
  if (!signedByEasebuzz(cfg, form)) return json({ error: 'Bad signature' }, 400);
  const orderId = orderIdOf(form.txnid);
  if (!orderId) return json({ ok: true, ignored: 'not one of our orders' }); // e.g. a payment link made in their dashboard
  try {
    const r = await settle(orderId);
    return json({ ok: true, state: r?.state ?? 'unknown order' });
  } catch (e) {
    console.error('Easebuzz webhook could not be settled', e);
    return json({ error: 'Try again' }, 500); // Easebuzz will send it again
  }
}
