-- Discount codes, the customer's phone number (optional, for offers), and the owner's kiosk switches.
-- Run in Supabase → SQL editor after 0004. Safe to run twice.

-- Codes the owner creates in the dashboard. Amounts in whole rupees.
create table if not exists public.discount_codes (
  code text primary key check (code ~ '^[A-Z0-9]{3,16}$'),
  kind text not null check (kind in ('percent', 'flat')),
  value int not null check (value >= 1 and ((kind = 'percent' and value <= 90) or (kind = 'flat' and value <= 100000))),
  min_order int check (min_order is null or min_order between 1 and 100000),
  max_discount int check (max_discount is null or max_discount between 1 and 100000),
  expires_on date,                 -- last day (IST) the code works
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row: what the kiosk asks for. The owner switches these in the dashboard.
create table if not exists public.kiosk_settings (
  id int primary key check (id = 1),
  codes boolean not null default true,
  phone boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.kiosk_settings (id) values (1) on conflict (id) do nothing;

alter table public.discount_codes enable row level security;
alter table public.kiosk_settings enable row level security;

-- The discount amount is already stored in orders.savings; this is which code gave it.
alter table public.orders add column if not exists discount_code text;
-- Ten digits. Only taken with the "offers from Benne 14" line shown, so a stored number carries consent.
alter table public.orders add column if not exists customer_phone text
  check (customer_phone is null or customer_phone ~ '^[6-9][0-9]{9}$');
create index if not exists orders_customer_phone on public.orders (customer_phone) where customer_phone is not null;

-- The change history also records codes and the kiosk switches.
alter table public.admin_events drop constraint if exists admin_events_kind_check;
alter table public.admin_events add constraint admin_events_kind_check
  check (kind in ('price', 'name', 'desc', 'sold_out', 'back_on', 'option_price', 'refund', 'discount', 'setting'));

-- place_order gains p_phone and stores the code's name. The 5-argument version is replaced.
drop function if exists public.place_order(text, text, text, text, jsonb);
create or replace function public.place_order(
  p_key text, p_type text, p_name text, p_pay text, p_priced jsonb, p_phone text default ''
)
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
                             subtotal, cgst, sgst, round_off, total, savings, discount_code, customer_phone)
  values (p_key, n::text, d, p_type, nullif(p_name, ''), p_pay,
          case when p_pay = 'upi' then 'pending_payment' else 'awaiting_cash' end,  -- card + cash: paid at the counter
          p_priced -> 'lines', (p_priced ->> 'itemCount')::int,
          (p_priced ->> 'subtotal')::numeric, (p_priced ->> 'cgst')::numeric, (p_priced ->> 'sgst')::numeric,
          (p_priced ->> 'roundOff')::numeric, (p_priced ->> 'total')::numeric, (p_priced ->> 'savings')::numeric,
          nullif(p_priced ->> 'discountCode', ''), nullif(p_phone, ''))
  on conflict (idempotency_key) do nothing
  returning * into o;

  if o.id is null then
    select * into o from public.orders where idempotency_key = p_key;
  end if;
  return o;
end;
$$;

revoke execute on function public.place_order(text, text, text, text, jsonb, text) from public, anon, authenticated;

-- The dashboard's customer list: one row per phone number, from paid orders only.
-- security_invoker: the view obeys the orders table's row-level security, so only the server can read it.
create or replace view public.customers with (security_invoker = true) as
select
  customer_phone as phone,
  (array_agg(customer_name order by created_at desc) filter (where customer_name is not null))[1] as name,
  count(*)::int as orders,
  coalesce(sum(total) filter (where refunded_at is null), 0)::numeric(12, 2) as spent,
  min(created_at) as first_order_at,
  max(created_at) as last_order_at
from public.orders
where customer_phone is not null and status in ('new', 'cooking', 'ready', 'handed_over')
group by customer_phone;

revoke all on public.customers from public, anon, authenticated;

insert into public.schema_migrations (name) values ('0005_discount_codes_and_phone') on conflict (name) do nothing;
