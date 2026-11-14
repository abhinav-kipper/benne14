import { getStore } from '@/lib/store';
import { fail, isOrderId, json, notFound, readJson, staffCheck, staffDenied } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Kitchen: `count` of line number `line` have been given to the customer (a long order goes out in parts).
// The count is the new total for the line, not "one more", so a retried request can't tick twice.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pin = staffCheck(req);
  if (pin !== 'ok') return staffDenied(pin);
  try {
    const { id } = await ctx.params;
    if (!isOrderId(id)) return notFound();
    const { line, count } = (await readJson(req)) as { line?: unknown; count?: unknown };
    const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 999;
    if (!whole(line) || !whole(count)) return json({ error: 'Bad tick' }, 400);
    return json(await getStore().setGiven(id, line, count));
  } catch (e) {
    return fail(e);
  }
}
