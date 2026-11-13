import { adminDenied, rangeOf } from '@/lib/admin';
import { billsCsv, dishesCsv, gstCsv } from '@/lib/reports';
import { getStore } from '@/lib/store';
import { fail, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// CSV for the CA: ?kind=bills|gst|dishes&from&to
export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const kind = new URL(req.url).searchParams.get('kind');
    if (kind !== 'bills' && kind !== 'gst' && kind !== 'dishes')
      return json({ error: 'Pick bills, gst or dishes' }, 400);
    const { from, to } = rangeOf(req);
    const orders = await getStore().listRange(from, to);
    const body =
      kind === 'bills' ? billsCsv(orders) : kind === 'gst' ? gstCsv(orders, from, to) : dishesCsv(orders, from, to);
    return new Response('﻿' + body, {
      // BOM so Excel reads ₹ and names correctly
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="benne14-${kind}-${from}-to-${to}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return fail(e);
  }
}
