import QRCode from 'qrcode';
import { easebuzzConfig, startPayment } from '@/lib/easebuzz';
import { settle } from '@/lib/gateway';
import { getStore } from '@/lib/store';
import { fail, isOrderId, json, notFound, paymentMode, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Easebuzz starts a payment once per order; asking again (a reloaded kiosk) gets the same answer
// from here for as long as the payment link lives. Per server instance: a different instance falls
// back to the shop's own QR, which still works.
type View = { kind: 'page'; url: string } | { kind: 'qr'; svg: string };
const started = new Map<string, { view: View; at: number }>();
const LINK_MS = 14 * 60_000;

// The kiosk's UPI screen talks to the payment gateway through here (no PIN: only the kiosk knows the
// order id, as with /claim).
//  { action: 'start' } → how to show the payment for this order:
//      { kind: 'direct' }            the shop's own QR, staff confirm (no gateway, or it didn't answer)
//      { kind: 'page', url }         Easebuzz's payment page, shown in a frame
//      { kind: 'qr', svg }           a QR we draw from Easebuzz's UPI link (seamless mode)
//  { action: 'check' } → { order, state }: asks Easebuzz whether it is paid, and if so sends the order
//      to the kitchen. The kiosk calls this every few seconds while the QR is on screen.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isOrderId(id)) return notFound();
    const { action } = await readJson(req);
    if (action !== 'start' && action !== 'check') return json({ error: 'Bad action' }, 400);
    const cfg = paymentMode() === 'easebuzz' ? easebuzzConfig() : null;
    const order = await getStore().getOrder(id);
    if (!order) return notFound();

    if (action === 'check') {
      if (!cfg) return json({ order, state: 'waiting' });
      try {
        return json((await settle(id)) ?? { order, state: 'waiting' });
      } catch (e) {
        console.error('Easebuzz status check failed', e);
        return json({ order, state: 'waiting' }); // can't tell right now: keep waiting, the webhook may still come
      }
    }

    if (!cfg || order.payMethod !== 'upi' || order.status !== 'pending_payment') return json({ kind: 'direct' });
    const again = started.get(id);
    if (again && Date.now() - again.at < LINK_MS) return json(again.view);
    try {
      const back = new URL('/api/payments/easebuzz/return', req.url).toString();
      const s = await startPayment(cfg, order, back);
      const view: View =
        s.kind === 'page'
          ? { kind: 'page', url: s.url }
          : {
              kind: 'qr',
              svg: await QRCode.toString(s.url, {
                type: 'svg',
                margin: 0,
                errorCorrectionLevel: 'M',
                color: { dark: '#1C1A15', light: '#00000000' },
              }),
            };
      started.set(id, { view, at: Date.now() });
      if (started.size > 500) started.delete(started.keys().next().value!); // bound memory
      return json(view);
    } catch (e) {
      // The gateway is down or refused: the customer can still pay to the shop's own QR.
      console.error('Easebuzz start failed, falling back to the direct QR', e);
      return json({ kind: 'direct' });
    }
  } catch (e) {
    return fail(e);
  }
}
