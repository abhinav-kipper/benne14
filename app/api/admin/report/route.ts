import { adminDenied, rangeOf } from '@/lib/admin';
import { previousPeriod, summarize } from '@/lib/reports';
import { getStore } from '@/lib/store';
import { fail, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Takings, dishes, busy hours and GST for ?from&to (IST days), plus the same-length period before it.
export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const { from, to } = rangeOf(req);
    const prev = previousPeriod(from, to);
    const orders = await getStore().listRange(prev.from, to);
    const cur = orders.filter((o) => o.tokenDay >= from);
    const old = orders.filter((o) => o.tokenDay < from);
    return json({
      from,
      to,
      current: summarize(cur, from, to),
      previous: { ...prev, summary: summarize(old, prev.from, prev.to) },
    });
  } catch (e) {
    return fail(e);
  }
}
