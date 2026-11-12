import { json, staffOk } from '@/lib/server';

export const dynamic = 'force-dynamic';

// The kitchen checks the PIN here when it is typed, so a wrong PIN is caught at once instead of
// being saved and failing on the first tap.
export async function POST(req: Request) {
  return staffOk(req) ? json({ ok: true }) : json({ error: 'Wrong PIN' }, 401);
}
