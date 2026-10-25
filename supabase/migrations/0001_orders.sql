-- Benne 14 v1: orders with daily tokens. Menu stays in code until the owner admin (M4).
-- Only the server (service role) touches these tables; RLS is on with no policies, so the
-- public anon key can neither read nor write orders.

create table if not exists public.token_counters (
  day date primary key,
  last int not null
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  token text not null,
  token_day date not null,
  type text not null check (type in ('dine_in', 'takeaway')),
  customer_name text,
  pay_method text not null check (pay_method in ('upi', 'card', 'cash')),
  status text not null check (status in ('pending_payment', 'awaiting_cash', 'new', 'cooking', 'ready', 'handed_over', 'cancelled')),
  lines jsonb not null,            -- priced lines: names, prices, extras and notes snapshotted at order time
  item_count int not null,
  subtotal numeric(10, 2) not null,
  cgst numeric(10, 2) not null,
  sgst numeric(10, 2) not null,
  round_off numeric(10, 2) not null,
  total numeric(10, 2) not null,
  savings numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  ready_at timestamptz,
  unique (token_day, token)
);

create index if not exists orders_day_status on public.orders (token_day, status);

alter table public.orders enable row level security;
alter table public.token_counters enable row level security;

-- Places an order atomically: idempotent on p_key, next token for today (IST).
create or replace function public.place_order(p_key text, p_type text, p_name text, p_pay text, p_priced jsonb)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (now() at time zone 'Asia/Kolkata')::date;
  n int;
  o public.orders;
begin
  select * into o from public.orders where idempotency_key = p_key;
  if found then return o; end if;

  insert into public.token_counters (day, last) values (d, 1)
    on conflict (day) do update set last = public.token_counters.last + 1
    returning last into n;

  insert into public.orders (idempotency_key, token, token_day, type, customer_name, pay_method, status, lines, item_count,
                             subtotal, cgst, sgst, round_off, total, savings)
  values (p_key, 'A-' || lpad(n::text, 3, '0'), d, p_type, nullif(p_name, ''), p_pay,
          case when p_pay = 'upi' then 'pending_payment' else 'awaiting_cash' end,  -- card + cash: paid at the counter
          p_priced -> 'lines', (p_priced ->> 'itemCount')::int,
          (p_priced ->> 'subtotal')::numeric, (p_priced ->> 'cgst')::numeric, (p_priced ->> 'sgst')::numeric,
          (p_priced ->> 'roundOff')::numeric, (p_priced ->> 'total')::numeric, (p_priced ->> 'savings')::numeric)
  on conflict (idempotency_key) do nothing
  returning * into o;

  if o.id is null then
    select * into o from public.orders where idempotency_key = p_key;
  end if;
  return o;
end;
$$;

revoke execute on function public.place_order(text, text, text, text, jsonb) from public, anon, authenticated;
