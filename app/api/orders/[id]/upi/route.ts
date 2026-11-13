import QRCode from 'qrcode';
import { DirectUpiProvider, MockProvider } from '@/lib/payments';
import { getStore } from '@/lib/store';
import { fail, isOrderId, json, notFound, paymentsAreMock } from '@/lib/server';

export const dynamic = 'force-dynamic';

// UPI QR for an order, as SVG (amount fixed inside the QR).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isOrderId(id)) return notFound();
    const order = await getStore().getOrder(id);
    if (!order) return json({ error: 'Order not found' }, 404);
    if (order.status !== 'pending_payment') return json({ error: 'This order is no longer waiting for UPI' }, 409);
    const { payload } = (paymentsAreMock() ? MockProvider : DirectUpiProvider).upiRequest(order);
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#1C1A15', light: '#00000000' },
    });
    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(e);
  }
}
