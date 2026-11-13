import { getStore } from '@/lib/store';
import { fail, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// The owner's menu changes (prices, names, sold out today), merged on screens with lib/menu's mergeCatalog.
// Public: it's what the kiosk shows anyway.
export async function GET() {
  try {
    return json(await getStore().getOverrides());
  } catch (e) {
    return fail(e);
  }
}
