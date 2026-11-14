import { after } from 'next/server';
import { adminDenied } from '@/lib/admin';
import { fail, json } from '@/lib/server';
import { getStore } from '@/lib/store';
import { systemReport, watchIsDue, watchQuietly } from '@/lib/watch';

export const dynamic = 'force-dynamic';

// The owner app's System page: every screen and when it was last heard from, what needs a look,
// the alerts sent to the owner's phone, and the latest errors.
export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const store = getStore();
    if (watchIsDue()) after(() => watchQuietly(store));
    return json(await systemReport(store));
  } catch (e) {
    return fail(e);
  }
}
