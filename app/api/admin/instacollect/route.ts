import { adminDenied } from '@/lib/admin';
import { instaCollectConfig, selfCheck } from '@/lib/instacollect';
import { fail, json, limited, clientKey } from '@/lib/server';
import { SHOP } from '@/lib/shop';

export const dynamic = 'force-dynamic';

// "Does InstaCollect work with our keys?" The owner taps this on the technical page; the server
// asks the real Easebuzz (look-up, a ₹1 QR, cancel it) and reports each answer. Works whichever
// way of taking UPI is switched on, so it can be tried before switching. Owner PIN; at most a few
// times a minute, since each run talks to Easebuzz.
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    if (limited(`iccheck:${clientKey(req)}`, 4, 60_000))
      return json({ error: 'Wait a minute before checking again' }, 429);
    const cfg = instaCollectConfig();
    if (!cfg)
      return json({
        steps: [
          {
            step: 'Keys set',
            ok: false,
            detail: 'EASEBUZZ_WIRE_KEY and EASEBUZZ_WIRE_SALT are not set on this server',
          },
        ],
      });
    return json({ steps: await selfCheck(cfg, SHOP.phone) });
  } catch (e) {
    return fail(e);
  }
}
