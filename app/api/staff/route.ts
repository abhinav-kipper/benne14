import { json, ownerCheck, ownerPin, staffCheck, staffDenied, staffPin } from '@/lib/server';

export const dynamic = 'force-dynamic';

// How many digits each PIN pad should take. Public: the length of a PIN is not the PIN.
export async function GET() {
  return json({ staffDigits: staffPin().length || 4, ownerDigits: (ownerPin() || staffPin()).length || 4 });
}

// A PIN pad checks the PIN here when it is typed, so a wrong PIN is caught at once instead of
// being saved and failing on the first tap. ?for=owner checks the owner app's PIN.
export async function POST(req: Request) {
  const owner = new URL(req.url).searchParams.get('for') === 'owner';
  const r = owner ? ownerCheck(req) : staffCheck(req);
  return r === 'ok' ? json({ ok: true }) : r === 'locked' ? staffDenied(r) : json({ error: 'Wrong PIN' }, 401);
}
