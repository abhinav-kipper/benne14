-- A GST tax invoice needs a number that is unique and runs without gaps within a financial year
-- (CGST Rule 46(b): at most 16 characters). The daily order number (1, 2, 3… every morning) is not
-- that. Every order gets an invoice number at the moment it is paid, e.g. B14/26-27/000123; an
-- order that is never paid never gets one. Run in Supabase → SQL editor after 0014. Safe to run twice.

alter table public.orders add column if not exists invoice_no text;
create unique index if not exists orders_invoice_no on public.orders (invoice_no) where invoice_no is not null;

-- One counter per financial year (April to March, by the date in India).
create table if not exists public.invoice_counters (
  fy text primary key check (fy ~ '^[0-9]{2}-[0-9]{2}$'),
  last integer not null check (last >= 0)
);
alter table public.invoice_counters enable row level security;
revoke all on public.invoice_counters from anon, authenticated;

-- Runs in the same transaction as the payment: if the payment is not saved, the number is not used.
create or replace function public.orders_invoice() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d date;
  y int;
  v_fy text;
  v_n int;
begin
  -- once given, an invoice number never changes and is never taken away
  if old.invoice_no is not null and new.invoice_no is distinct from old.invoice_no then
    raise exception 'Order %: the invoice number cannot be changed', old.token using errcode = 'P0001';
  end if;
  if old.paid_at is null and new.paid_at is not null and new.invoice_no is null then
    d := (new.paid_at at time zone 'Asia/Kolkata')::date;
    y := extract(year from d)::int - case when extract(month from d) < 4 then 1 else 0 end;
    v_fy := lpad((y % 100)::text, 2, '0') || '-' || lpad(((y + 1) % 100)::text, 2, '0');
    insert into public.invoice_counters as c (fy, last) values (v_fy, 1)
      on conflict (fy) do update set last = c.last + 1
      returning c.last into v_n;
    new.invoice_no := 'B14/' || v_fy || '/' || lpad(v_n::text, 6, '0');
  elsif old.invoice_no is null and new.invoice_no is not null then
    raise exception 'Order %: an invoice number is given only when the order is paid', old.token
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_invoice on public.orders;
create trigger orders_invoice before update on public.orders
  for each row execute function public.orders_invoice();

insert into public.schema_migrations (name) values ('0015_invoice_numbers') on conflict (name) do nothing;
