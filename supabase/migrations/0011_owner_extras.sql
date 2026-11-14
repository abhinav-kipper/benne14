-- The owner's own extras and kitchen notes: add an extra to a set, rename and switch extras off, make
-- a new set of extras, choose which set a dish offers, add kitchen notes. Run in Supabase → SQL editor
-- after 0010. Safe to run twice.

-- One JSON value on the menu's layout row (see ExtrasLayout in lib/menu.ts):
-- { "options": { "dosaExtras": [{ "id": "x-ab12cd34", "name": "Extra cheese", "price": 30 }] },
--   "names": { "dosaExtras:podi": "Extra gunpowder" }, "hidden": ["dosaExtras:palya"],
--   "sets": [{ "id": "g-ab12cd34", "name": "Add on top" }], "dishSets": { "masala-tea": ["sugar"] },
--   "notes": [{ "id": "n-ab12cd34", "label": "No onion", "tone": "less", "cats": ["dosa"] }],
--   "hiddenNotes": ["extra-crisp"] }
alter table public.menu_layout add column if not exists extras jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_layout_extras_check') then
    alter table public.menu_layout add constraint menu_layout_extras_check check (jsonb_typeof(extras) = 'object');
  end if;
end $$;

insert into public.schema_migrations (name) values ('0011_owner_extras') on conflict (name) do nothing;
