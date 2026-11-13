-- Payments confirmed by a gateway (Easebuzz): which gateway said "paid" and its reference, kept on the
-- order and in the order's history. Run in Supabase → SQL editor after 0006. Safe to run twice.

alter table public.orders add column if not exists pay_gateway text;
alter table public.orders add column if not exists pay_ref text;      -- the gateway's payment id, e.g. E2603240VUHFQ3
alter table public.orders add column if not exists pay_bank_ref text; -- the UPI reference the customer sees

-- A payment that arrives for an order that can no longer take it (cancelled, or already paid another
-- way) is recorded in the change history so the owner can refund it.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'admin_events_kind_check' and pg_get_constraintdef(oid) like '%payment%') then
    alter table public.admin_events drop constraint if exists admin_events_kind_check;
    alter table public.admin_events add constraint admin_events_kind_check
      check (kind in ('price', 'name', 'desc', 'sold_out', 'back_on', 'option_price', 'refund', 'discount', 'setting', 'payment'));
  end if;
end $$;

-- The guard from 0006, plus: a gateway reference is written once (with the payment) and never changed.
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
  if old.paid_at is not null and new.paid_at is distinct from old.paid_at then
    raise exception 'Order %: the payment time cannot be changed', old.token using errcode = 'P0001';
  end if;
  if old.pay_ref is not null
     and (new.pay_gateway, new.pay_ref, new.pay_bank_ref) is distinct from (old.pay_gateway, old.pay_ref, old.pay_bank_ref) then
    raise exception 'Order %: the payment reference cannot be changed', old.token using errcode = 'P0001';
  end if;
  if new.pay_ref is not null and new.status not in ('new', 'cooking', 'ready', 'handed_over') then
    raise exception 'Order %: a payment reference belongs to a paid order', old.token using errcode = 'P0001';
  end if;
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

-- The log from 0006, plus: when a gateway confirmed the payment, the history line says which and its reference.
create or replace function public.orders_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, kind, to_status) values (new.id, 'placed', new.status);
  else
    if new.status is distinct from old.status then
      insert into public.order_events (order_id, kind, from_status, to_status, note)
        values (new.id, 'status', old.status, new.status,
                case when old.pay_ref is null and new.pay_ref is not null
                     then initcap(new.pay_gateway) || ' ' || new.pay_ref
                          || coalesce(' · UPI ref ' || new.pay_bank_ref, '') end);
    end if;
    if old.refunded_at is null and new.refunded_at is not null then
      insert into public.order_events (order_id, kind, note)
        values (new.id, 'refund', '₹' || trim(to_char(new.refund_amount, 'FM999999990')) || ' · ' || new.refund_reason);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.orders_log() from public, anon, authenticated;

insert into public.schema_migrations (name) values ('0007_gateway_payments') on conflict (name) do nothing;
