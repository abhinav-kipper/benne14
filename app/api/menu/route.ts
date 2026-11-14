import { getStore } from '@/lib/store';
import { fail, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// The owner's menu changes (prices, names, sold out today), merged on screens with lib/menu's mergeCatalog.
// Public: it's what the kiosk shows anyway.
export async function GET() {
  try {
    const o = await getStore().getOverrides();
    // Drafts are the owner's own business until published (the dashboard reads /api/admin/dishes).
    return json({ ...o, custom: (o.custom ?? []).filter((c) => c.live) });
  } catch (e) {
    return fail(e);
  }
}
