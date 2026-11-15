// The change history shown in the owner app.
import { type AdminEvent } from '../../orders';
import { StoreError } from '../memory';
import { type Db } from './shared';

export async function addEvent(db: Db, e: Omit<AdminEvent, 'at'>) {
  const { error } = await db.from('admin_events').insert({
    kind: e.kind,
    subject: e.subject,
    before: e.before ?? null,
    after: e.after ?? null,
    note: e.note ?? null,
  });
  if (error) throw new StoreError(error.message, 500);
}

export async function listEvents(db: Db, limit = 100) {
  const { data, error } = await db
    .from('admin_events')
    .select('at,kind,subject,before,after,note')
    .order('at', { ascending: false })
    .limit(limit);
  if (error) throw new StoreError(error.message, 500);
  return data as AdminEvent[];
}
