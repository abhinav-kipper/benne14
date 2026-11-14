import { getStore } from '@/lib/store';
import { clientKey, json, limited } from '@/lib/server';
import { watch } from '@/lib/watch';

export const dynamic = 'force-dynamic';

// Run the system check now. The uptime job calls this every 15 minutes, so the owner's phone still
// hears about a silent kiosk when no other screen is awake to trigger the check. It says only
// whether it ran: what is wrong is for the owner app, behind the PIN.
export async function GET(req: Request) {
  if (limited(`watch:${clientKey(req)}`, 6, 60_000)) return json({ ok: false }, 429);
  try {
    await watch(getStore());
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}
