import QRCode from 'qrcode';
import { MockProvider } from '@/lib/payments';
import { getStore } from '@/lib/store';
import { fail, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// UPI QR for an order, as SVG (amount fixed inside the QR).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const order = await getStore().getOrder(id);
    if (!order) return json({ error: 'Order not found' }, 404);
    const { payload } = MockProvider.upiRequest(order);
    const svg = await QRCode.toString(payload, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1C1A15', light: '#00000000' } });
    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(e);
  }
}
