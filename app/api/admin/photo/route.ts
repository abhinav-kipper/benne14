import { adminDenied } from '@/lib/admin';
import { getStore } from '@/lib/store';
import { fail, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 1024 * 1024; // the owner app shrinks a photo to well under this before sending

// A dish photo: the request body is the JPEG itself. Answers with the address to show it from.
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return json({ error: 'The photo is too big' }, 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > MAX_BYTES) return json({ error: 'The photo is too big' }, 413);
    // JPEG only, judged by its first bytes, not by what the request says it is.
    if (bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
      return json({ error: 'That is not a photo' }, 400);
    return json({ url: await getStore().savePhoto(bytes) });
  } catch (e) {
    return fail(e);
  }
}
