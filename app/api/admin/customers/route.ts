import { adminDenied } from '@/lib/admin';
import { customersCsv } from '@/lib/reports';
import { getStore } from '@/lib/store';
import { fail, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Phone numbers customers gave at the kiosk (with the offers line shown). ?format=csv downloads them.
export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const list = await getStore().listCustomers();
    if (new URL(req.url).searchParams.get('format') !== 'csv') return json(list);
    return new Response('﻿' + customersCsv(list), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="benne14-customers.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return fail(e);
  }
}
