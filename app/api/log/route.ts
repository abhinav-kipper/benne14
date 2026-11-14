import { getStore } from '@/lib/store';
import { clientKey, json, limited, readJson } from '@/lib/server';
import { ERROR_SOURCES, clip, isDeviceId } from '@/lib/system';

export const dynamic = 'force-dynamic';

// A screen reporting that something went wrong on it, so it can be seen on the owner app's System
// page and fixed. Open (the kiosk has no PIN), so: a few short fields, a handful of reports a
// minute from one address, and the store keeps only the newest few hundred.
export async function POST(req: Request) {
  try {
    if (limited(`log:${clientKey(req)}`, 10, 60_000)) return json({ ok: false }, 429);
    const b = await readJson(req);
    const source = ERROR_SOURCES.find((s) => s === b.source && s !== 'server'); // only the server speaks for the server
    const message = clip(b.message, 300);
    if (!source || !message) return json({ error: 'Bad report' }, 400);
    await getStore().logError({
      source,
      message,
      detail: clip(b.detail, 2000) || null,
      build: clip(b.build, 64) || null,
      device: isDeviceId(b.device) ? b.device : null,
    });
    return json({ ok: true });
  } catch {
    return json({ ok: false });
  }
}
