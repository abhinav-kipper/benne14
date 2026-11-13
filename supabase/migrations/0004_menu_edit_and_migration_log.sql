-- 1) A menu edit (dish fields + extras' prices + history lines) saves in one transaction.
-- 2) A log of which migrations have been run, shown on /api/health.
-- Run in Supabase → SQL editor. Safe to run twice.

create or replace function public.save_menu_edit(p_item_id text, p_item jsonb, p_options jsonb, p_events jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_item <> '{}'::jsonb then
    insert into public.menu_overrides (item_id) values (p_item_id) on conflict (item_id) do nothing;
    -- only the keys present in p_item change; a JSON null resets that field to the menu in code
    update public.menu_overrides set
      name = case when p_item ? 'name' then p_item ->> 'name' else name end,
      description = case when p_item ? 'description' then p_item ->> 'description' else description end,
      price = case when p_item ? 'price' then (p_item ->> 'price')::int else price end,
      sold_out_on = case when p_item ? 'sold_out_on' then (p_item ->> 'sold_out_on')::date else sold_out_on end,
      updated_at = now()
    where item_id = p_item_id;
  end if;

  insert into public.option_overrides (group_id, option_id, price)
    select o ->> 'group_id', o ->> 'option_id', (o ->> 'price')::int from jsonb_array_elements(p_options) o
    on conflict (group_id, option_id) do update set price = excluded.price, updated_at = now();

  insert into public.admin_events (kind, subject, before, after, note)
    select e ->> 'kind', e ->> 'subject', e ->> 'before', e ->> 'after', e ->> 'note' from jsonb_array_elements(p_events) e;
end;
$$;

revoke execute on function public.save_menu_edit(text, jsonb, jsonb, jsonb) from public, anon, authenticated;

create table if not exists public.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;

-- 0001–0003 were run by hand before this log existed (0003's tables are checked by the app itself).
insert into public.schema_migrations (name) values
  ('0001_orders'), ('0002_plain_tokens'), ('0003_owner_dashboard'), ('0004_menu_edit_and_migration_log')
on conflict (name) do nothing;
