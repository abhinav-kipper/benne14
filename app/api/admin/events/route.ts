import { adminDenied } from '@/lib/admin';
import { getStore } from '@/lib/store';
import { fail, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Change history: menu edits and refunds, newest first.
export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    return json(await getStore().listEvents(200));
  } catch (e) {
    return fail(e);
  }
}
