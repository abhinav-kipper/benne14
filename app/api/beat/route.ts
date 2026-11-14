import { getStore } from '@/lib/store';
import { clientKey, json, limited, readJson } from '@/lib/server';
import { DEVICE_KINDS, clip, isDeviceId } from '@/lib/system';

export const dynamic = 'force-dynamic';

// A screen saying "I'm here" (every half minute): which screen it is, what it is showing and the
// version it runs. Open to the kiosk, which has no PIN, so it takes only these few short fields and
// the store caps how many screens it will remember. It never fails the screen that called it.
export async function POST(req: Request) {
  try {
    // the shop's screens share one Wi-Fi address: a dozen screens at two a minute, with room to spare
    if (limited(`beat:${clientKey(req)}`, 60, 60_000)) return json({ ok: false }, 429);
    const b = await readJson(req);
    const kind = DEVICE_KINDS.find((k) => k === b.kind);
    if (!kind || !isDeviceId(b.id)) return json({ error: 'Bad beat' }, 400);
    await getStore().beat({ id: b.id, kind, screen: clip(b.screen, 24) || null, build: clip(b.build, 64) || null });
    return json({ ok: true });
  } catch {
    return json({ ok: false });
  }
}
