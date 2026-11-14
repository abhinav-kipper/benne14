import { getStore } from '@/lib/store';
import { json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// "Can an order be taken right now?" One small read of the database. The kiosk asks every few
// seconds and sends customers to the counter while the answer is no. Public: it says nothing else.
export async function GET() {
  try {
    await getStore().getSettings();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}
