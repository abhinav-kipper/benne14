-- Order numbers become plain numbers ("42" instead of "A-042"). The app already shows old tokens
-- as plain numbers, so running this is optional; it only changes what new rows store.
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
  values (p_key, n::text, d, p_type, nullif(p_name, ''), p_pay,
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
