import { adminDenied } from '@/lib/admin';
import { getStore } from '@/lib/store';
import { fail, isOrderId, json, notFound } from '@/lib/server';

export const dynamic = 'force-dynamic';

// One order's history for the dashboard: placed, each change of state, a refund, with times.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    if (!isOrderId(id)) return notFound();
    return json(await getStore().listOrderEvents(id));
  } catch (e) {
    return fail(e);
  }
}
