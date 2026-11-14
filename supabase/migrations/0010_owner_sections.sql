-- The owner's own menu sections: add a section, rename, reorder and hide sections from the dashboard.
-- Run in Supabase → SQL editor after 0009. Safe to run twice.

-- One JSON value on the menu's layout row:
-- { "custom": [{ "id": "s-ab12cd34", "name": "Sweets" }], "names": { "dosa": "Dosa" },
--   "order": ["drinks", "dosa"], "hidden": ["idli"] }
alter table public.menu_layout add column if not exists sections jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_layout_sections_check') then
    alter table public.menu_layout add constraint menu_layout_sections_check check (jsonb_typeof(sections) = 'object');
  end if;
end $$;

-- A dish the owner added may now sit in a section the owner added.
alter table public.menu_dishes drop constraint if exists menu_dishes_cat_check;
alter table public.menu_dishes add constraint menu_dishes_cat_check
  check (cat ~ '^(dosa|idli|drinks|s-[a-z0-9]{6,12})$');

insert into public.schema_migrations (name) values ('0010_owner_sections') on conflict (name) do nothing;
