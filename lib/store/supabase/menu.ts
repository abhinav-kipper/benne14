// The owner's menu changes: overrides, own dishes, layout, photos.
import { optionKey, type CustomItem, type ExtrasLayout, type Overrides, type SectionsLayout } from '../../menu';
import type { LayoutPatch, MenuEdit } from '../index';
import { istDay, type AdminEvent } from '../../orders';
import { StoreError } from '../memory';
import { PHOTO_BUCKET, missing, noColumn, storeError, type Db, type DishRow } from './shared';
import { addEvent } from './events';

export async function getOverrides(db: Db): Promise<Overrides> {
  const [items, options] = await Promise.all([
    db.from('menu_overrides').select('item_id,name,description,price,sold_out_on'),
    db.from('option_overrides').select('group_id,option_id,price'),
  ]);
  // Before migration 0003 is run the tables don't exist yet: keep the kiosk selling from the menu
  // in code rather than failing every order. Any other error is real and goes up.
  if (missing(items.error) || missing(options.error)) {
    console.error('menu_overrides/option_overrides missing: run supabase/migrations/0003_owner_dashboard.sql');
    return { items: {}, options: {} };
  }
  if (items.error) throw new StoreError(items.error.message, 500);
  if (options.error) throw new StoreError(options.error.message, 500);
  const today = istDay();
  const out: Overrides = { items: {}, options: {} };
  for (const r of items.data as {
    item_id: string;
    name: string | null;
    description: string | null;
    price: number | null;
    sold_out_on: string | null;
  }[]) {
    out.items[r.item_id] = { name: r.name, desc: r.description, price: r.price, soldOut: r.sold_out_on === today };
  }
  for (const r of options.data as { group_id: string; option_id: string; price: number }[])
    out.options[optionKey(r.group_id, r.option_id)] = r.price;

  // The owner's own dishes and the layout (migration 0009). Before it is run: none.
  // The layout row grew a column in 0010 (sections) and one in 0011 (extras): read what is there.
  const readLayout = async () => {
    for (const cols of ['hidden,item_order,sections,extras', 'hidden,item_order,sections', 'hidden,item_order']) {
      const r = await db.from('menu_layout').select(cols).eq('id', 1).maybeSingle();
      if (!noColumn(r.error)) return r as { data: unknown; error: typeof r.error };
    }
    return { data: null, error: null };
  };
  const [dishes, layout] = await Promise.all([
    db.from('menu_dishes').select('id,cat,name,description,price,groups,photo,live').order('created_at'),
    readLayout(),
  ]);
  if (missing(dishes.error) || missing(layout.error)) return out;
  if (dishes.error) throw new StoreError(dishes.error.message, 500);
  if (layout.error) throw new StoreError(layout.error.message, 500);
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  out.custom = (dishes.data as DishRow[]).map((r) => ({
    id: r.id,
    cat: r.cat,
    name: r.name,
    desc: r.description,
    price: r.price,
    groups: strings(r.groups),
    photo: r.photo,
    live: r.live,
  }));
  out.hidden = strings((layout.data as { hidden: unknown } | null)?.hidden);
  out.order = strings((layout.data as { item_order: unknown } | null)?.item_order);
  const sec = (layout.data as { sections?: unknown } | null)?.sections;
  const obj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  out.sections = obj(sec) ? (sec as SectionsLayout) : {};
  const ext = (layout.data as { extras?: unknown } | null)?.extras;
  out.extras = obj(ext) ? (ext as ExtrasLayout) : {};
  return out;
}

function needs0009(error: { code?: string } | null) {
  if (!missing(error)) return;
  console.error('menu_dishes/menu_layout missing: run supabase/migrations/0009_owner_dishes.sql');
  throw new StoreError('Adding dishes needs a database update (migration 0009)', 503);
}

export async function saveDish(db: Db, d: CustomItem, event: Omit<AdminEvent, 'at'> | null) {
  const { error } = await db.from('menu_dishes').upsert({
    id: d.id,
    cat: d.cat,
    name: d.name,
    description: d.desc,
    price: d.price,
    groups: d.groups,
    photo: d.photo,
    live: d.live,
    updated_at: new Date().toISOString(),
  });
  needs0009(error);
  if (error) throw storeError(error);
  if (event) await addEvent(db, event);
}

export async function deleteDish(db: Db, id: string, event: Omit<AdminEvent, 'at'>) {
  const { data, error } = await db.from('menu_dishes').delete().eq('id', id).select('id');
  needs0009(error);
  if (error) throw new StoreError(error.message, 500);
  if (!(data as unknown[]).length) throw new StoreError('No such dish', 404);
  await addEvent(db, event);
}

export async function saveLayout(db: Db, patch: LayoutPatch, event: Omit<AdminEvent, 'at'> | null) {
  const row: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
  if (patch.hidden) row.hidden = patch.hidden;
  if (patch.order) row.item_order = patch.order;
  if (patch.sections) row.sections = patch.sections;
  if (patch.extras) row.extras = patch.extras;
  const { error } = await db.from('menu_layout').upsert(row);
  if (noColumn(error)) {
    const [what, file] = patch.extras ? ['Extras', '0011_owner_extras'] : ['Sections', '0010_owner_sections'];
    console.error(`menu_layout column missing: run supabase/migrations/${file}.sql`);
    throw new StoreError(`${what} need a database update (migration ${file.slice(0, 4)})`, 503);
  }
  needs0009(error);
  if (error) throw storeError(error);
  if (event) await addEvent(db, event);
}

export async function savePhoto(db: Db, jpeg: Uint8Array) {
  const path = `${istDay()}/${crypto.randomUUID()}.jpg`;
  const bucket = db.storage.from(PHOTO_BUCKET);
  const { error } = await bucket.upload(path, jpeg, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) {
    console.error('dish photo upload failed', error.message);
    throw new StoreError('The photo could not be stored (has migration 0009 been run?)', 503);
  }
  return bucket.getPublicUrl(path).data.publicUrl;
}

export async function saveMenuEdit(db: Db, e: MenuEdit) {
  const item: Record<string, unknown> = {};
  if (e.patch.name !== undefined) item.name = e.patch.name;
  if (e.patch.desc !== undefined) item.description = e.patch.desc;
  if (e.patch.price !== undefined) item.price = e.patch.price;
  if (e.patch.soldOut !== undefined) item.sold_out_on = e.patch.soldOut ? istDay() : null;
  const options = e.options.map((o) => ({ group_id: o.groupId, option_id: o.optionId, price: o.price }));
  const events = e.events.map((v) => ({
    kind: v.kind,
    subject: v.subject,
    before: v.before ?? null,
    after: v.after ?? null,
    note: v.note ?? null,
  }));
  // One database transaction (migration 0004), so an edit can't half-save.
  const rpc = await db.rpc('save_menu_edit', {
    p_item_id: e.itemId,
    p_item: item,
    p_options: options,
    p_events: events,
  });
  if (!rpc.error) return;
  if (rpc.error.code !== 'PGRST202' && rpc.error.code !== '42883') throw new StoreError(rpc.error.message, 500);
  // Migration 0004 not run yet: save step by step, as before it existed.
  console.error('save_menu_edit missing: run supabase/migrations/0004_menu_edit_and_migration_log.sql');
  const now = new Date().toISOString();
  if (Object.keys(item).length) {
    const { error } = await db
      .from('menu_overrides')
      .upsert({ item_id: e.itemId, updated_at: now, ...item }, { onConflict: 'item_id' });
    if (error) throw new StoreError(error.message, 500);
  }
  if (options.length) {
    const { error } = await db.from('option_overrides').upsert(
      options.map((o) => ({ ...o, updated_at: now })),
      { onConflict: 'group_id,option_id' },
    );
    if (error) throw new StoreError(error.message, 500);
  }
  if (events.length) {
    const { error } = await db.from('admin_events').insert(events);
    if (error) throw new StoreError(error.message, 500);
  }
}
