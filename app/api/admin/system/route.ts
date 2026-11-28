import { after } from 'next/server';
import { adminDenied } from '@/lib/admin';
import { fail, json, readJson } from '@/lib/server';
import { getStore } from '@/lib/store';
import { isDeviceId, kindName } from '@/lib/system';
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

// Which devices are the shop's own screens:
// { shop: id }       this device is the shop's kiosk / kitchen tablet / TV (it takes the place of the last one)
// { notShop: id }    it is not, after all
// { forget: id }     take one device off the list      { forgetOthers: true }  every device that is not a shop screen
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const b = await readJson(req);
    const store = getStore();
    const said = (v: unknown) => (isDeviceId(v) ? v : null);
    if (b.shop !== undefined || b.notShop !== undefined) {
      const on = b.shop !== undefined;
      const id = said(on ? b.shop : b.notShop);
      const d = id ? (await store.listDevices()).find((x) => x.id === id) : undefined;
      if (!d) return json({ error: 'No such screen' }, 404);
      if (d.kind === 'owner') return json({ error: 'The owner app is not one of the shop’s screens' }, 400);
      await store.markDevice(d.id, on);
      await store.addEvent({
        kind: 'setting',
        subject: kindName(d.kind),
        after: on ? 'Set as the shop’s own screen' : 'No longer the shop’s own screen',
      });
      return json({ ok: true });
    }
    if (b.forget !== undefined) {
      const id = said(b.forget);
      if (!id) return json({ error: 'No such screen' }, 404);
      await store.forgetDevices(id);
      return json({ ok: true });
    }
    if (b.forgetOthers === true) return json({ ok: true, forgotten: await store.forgetDevices(null) });
    return json({ error: 'Nothing to change' }, 400);
  } catch (e) {
    return fail(e);
  }
}
