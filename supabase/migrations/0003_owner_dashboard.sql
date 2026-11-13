-- Owner dashboard (M4): menu changes, refunds, change history.
-- Run in Supabase → SQL editor after 0001 (and optionally 0002). Safe to run twice.

-- The owner's changes on top of the menu in code (lib/menu.ts). Prices in whole rupees.
create table if not exists public.menu_overrides (
  item_id text primary key,
  name text check (name is null or length(name) between 1 and 40),
  description text check (description is null or length(description) between 1 and 160),
  price int check (price is null or price between 1 and 100000),
  sold_out_on date,                -- sold out on this day (IST) only: back on by itself tomorrow
  updated_at timestamptz not null default now()
);

create table if not exists public.option_overrides (
  group_id text not null,
  option_id text not null,
  price int not null check (price between 0 and 100000),
  updated_at timestamptz not null default now(),
  primary key (group_id, option_id)
);

-- Refunds are recorded, not paid out by the app (money goes back via the Paytm app or the cash drawer).
alter table public.orders add column if not exists refunded_at timestamptz;
alter table public.orders add column if not exists refund_reason text;
alter table public.orders add column if not exists refund_amount numeric(10, 2);

-- What changed, when: menu edits and refunds.
create table if not exists public.admin_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('price', 'name', 'desc', 'sold_out', 'back_on', 'option_price', 'refund')),
  subject text not null,           -- dish / extra / order number, as shown
  before text,
  after text,
  note text
);
create index if not exists admin_events_at on public.admin_events (at desc);

alter table public.menu_overrides enable row level security;
alter table public.option_overrides enable row level security;
alter table public.admin_events enable row level security;
