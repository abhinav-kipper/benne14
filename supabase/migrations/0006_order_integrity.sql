-- Order integrity: the database itself refuses a bill that doesn't add up, an edit to a saved bill,
-- or an impossible status change; it logs every change of state; and a double submit can no longer
-- skip an order number. Run in Supabase → SQL editor after 0005. Safe to run twice.

-- 1) Bills must add up. NOT VALID: the rules bind every new or changed row, without re-judging rows
--    from before today's pricing rules (old test orders with the earlier discount and round-off).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_bill_adds_up') then
    alter table public.orders add constraint orders_bill_adds_up
      check (total = subtotal + cgst + sgst + round_off) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_amounts_sane') then
    alter table public.orders add constraint orders_amounts_sane
      check (subtotal >= 0 and cgst >= 0 and sgst >= 0 and cgst = sgst and total >= 1 and savings >= 0
             and item_count >= 1 and total = trunc(total) and savings = trunc(savings)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_names_its_code') then
    alter table public.orders add constraint orders_discount_names_its_code
      check ((savings > 0) = (discount_code is not null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_refund_is_whole') then
    alter table public.orders add constraint orders_refund_is_whole
      check ((refunded_at is null and refund_amount is null and refund_reason is null)
             or (refunded_at is not null and refund_amount = total and refund_reason is not null)) not valid;
  end if;
end $$;

-- 2) Which status changes are possible. The same table as NEXT in lib/orders.ts; a test compares them.
create or replace function public.order_move_ok(p_from text, p_to text) returns boolean
language sql immutable as $$
  select (p_from, p_to) in (
    ('pending_payment', 'new'), ('pending_payment', 'awaiting_cash'), ('pending_payment', 'cancelled'),
    ('awaiting_cash', 'new'), ('awaiting_cash', 'cancelled'),
    ('new', 'cooking'),
    ('cooking', 'ready'), ('cooking', 'new'),
    ('ready', 'handed_over'), ('ready', 'cooking'),
    ('handed_over', 'ready')
  );
$$;

-- 3) A saved bill can't be edited. After an order is placed only its state may change: status (along
--    the allowed moves), the paid/ready times, the refund (once), and the customer's name and phone
--    (so a number can be removed if a customer asks).
create or replace function public.orders_guard() returns trigger
language plpgsql as $$
begin
  if (new.idempotency_key, new.token, new.token_day, new.type, new.pay_method, new.lines, new.item_count,
      new.subtotal, new.cgst, new.sgst, new.round_off, new.total, new.savings, new.discount_code, new.created_at)
     is distinct from
     (old.idempotency_key, old.token, old.token_day, old.type, old.pay_method, old.lines, old.item_count,
      old.subtotal, old.cgst, old.sgst, old.round_off, old.total, old.savings, old.discount_code, old.created_at)
  then
    raise exception 'Order % is saved: its dishes, amounts and number cannot be changed', old.token
      using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not public.order_move_ok(old.status, new.status) then
    raise exception 'Order % cannot go from % to %', old.token, old.status, new.status using errcode = 'P0001';
  end if;
  -- paid is paid: the time of payment is set once and stays
  if old.paid_at is not null and new.paid_at is distinct from old.paid_at then
    raise exception 'Order %: the payment time cannot be changed', old.token using errcode = 'P0001';
  end if;
  -- a refund is recorded once, for a paid order
  if old.refunded_at is not null
     and (new.refunded_at, new.refund_amount, new.refund_reason)
         is distinct from (old.refunded_at, old.refund_amount, old.refund_reason) then
    raise exception 'Order %: the refund is already recorded', old.token using errcode = 'P0001';
  end if;
  if old.refunded_at is null and new.refunded_at is not null
     and new.status not in ('new', 'cooking', 'ready', 'handed_over') then
    raise exception 'Order % is not paid, so it cannot be refunded', old.token using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard on public.orders;
create trigger orders_guard before update on public.orders
  for each row execute function public.orders_guard();

-- 4) A log of every change of state, written by the database in the same transaction as the change,
--    so it cannot be forgotten or disagree with the order. (Who: the shop shares one PIN, so the log
--    has the time and the change, not a person.)
create table if not exists public.order_events (
  id bigserial primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('placed', 'status', 'refund')),
  from_status text,
  to_status text,
  note text
);
create index if not exists order_events_order on public.order_events (order_id, id);
alter table public.order_events enable row level security;

create or replace function public.orders_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, kind, to_status) values (new.id, 'placed', new.status);
  else
    if new.status is distinct from old.status then
      insert into public.order_events (order_id, kind, from_status, to_status)
        values (new.id, 'status', old.status, new.status);
    end if;
    if old.refunded_at is null and new.refunded_at is not null then
      insert into public.order_events (order_id, kind, note)
        values (new.id, 'refund', '₹' || trim(to_char(new.refund_amount, 'FM999999990')) || ' · ' || new.refund_reason);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists orders_log on public.orders;
create trigger orders_log after insert or update on public.orders
  for each row execute function public.orders_log();
revoke execute on function public.orders_log() from public, anon, authenticated;

-- 5) No skipped order numbers: two submits of the same checkout wait for each other, so the second
--    finds the first's order before it would take a number.
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
  perform pg_advisory_xact_lock(hashtextextended(p_key, 14));
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
  returning * into o;
  return o;
end;
$$;

revoke execute on function public.place_order(text, text, text, text, jsonb, text) from public, anon, authenticated;

insert into public.schema_migrations (name) values ('0006_order_integrity') on conflict (name) do nothing;
