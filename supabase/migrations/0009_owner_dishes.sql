-- The owner's own dishes: add a dish from the dashboard (with a photo), keep it as a draft until it is
-- published, hide a dish from the menu and bring it back, arrange the dishes in each section.
-- Run in Supabase → SQL editor after 0008. Safe to run twice.

-- Dishes the owner added. The dishes that came with the app stay in the code (lib/menu.ts); both are
-- merged into one menu. Orders keep their own copy of names and prices, so nothing here changes a bill.
create table if not exists public.menu_dishes (
  id text primary key check (id ~ '^c-[a-z0-9]{6,12}$'),
  cat text not null check (cat in ('dosa', 'idli', 'drinks')),
  name text not null check (length(name) between 1 and 40),
  description text not null default '' check (length(description) <= 160),
  price int not null check (price between 1 and 100000),
  groups jsonb not null default '[]'::jsonb check (jsonb_typeof(groups) = 'array'), -- sets of extras it offers
  photo text check (photo is null or length(photo) <= 400),
  live boolean not null default false, -- false = draft: only the owner sees it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.menu_dishes enable row level security;

-- One row: which dishes are hidden from the menu, and the order the owner arranged them in.
create table if not exists public.menu_layout (
  id int primary key default 1 check (id = 1),
  hidden jsonb not null default '[]'::jsonb check (jsonb_typeof(hidden) = 'array'),
  item_order jsonb not null default '[]'::jsonb check (jsonb_typeof(item_order) = 'array'),
  updated_at timestamptz not null default now()
);
alter table public.menu_layout enable row level security;

-- Change history gets a line for each of these ('menu').
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'admin_events_kind_check' and pg_get_constraintdef(oid) like '%''menu''%') then
    alter table public.admin_events drop constraint if exists admin_events_kind_check;
    alter table public.admin_events add constraint admin_events_kind_check
      check (kind in ('price', 'name', 'desc', 'sold_out', 'back_on', 'option_price', 'refund', 'discount',
                      'setting', 'payment', 'menu'));
  end if;
end $$;

-- Where dish photos are kept: a public bucket in Supabase Storage, JPEG only, at most 1 MB each.
-- Only the server (secret key) can upload; anyone can view, since the kiosk shows them.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('dish-photos', 'dish-photos', true, 1048576, array['image/jpeg'])
      on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg']
    $q$;
  end if;
end $$;

insert into public.schema_migrations (name) values ('0009_owner_dishes') on conflict (name) do nothing;
