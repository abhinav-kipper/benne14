-- Kitchen ticks: how many of each line of an order have already been given to the customer, so a
-- long order can go out in parts without the cook keeping it in their head.
-- Run in Supabase → SQL editor after 0007. Safe to run twice.

-- One count per line of the order, in the order's own line order: [3, 0, 2]. Empty = nothing given yet.
-- It is the kitchen's working note, not part of the bill, so the guard from 0006 lets it change.
alter table public.orders add column if not exists given jsonb not null default '[]'::jsonb;

-- One tick, written under a lock on the order so two tablets ticking different lines both count.
-- A tick on an order nobody has started yet also starts it (new → cooking).
create or replace function public.set_given(p_id uuid, p_line int, p_count int)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  n int;
  g jsonb;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if o.status not in ('new', 'cooking') then
    raise exception 'Order % is no longer in the kitchen', o.token using errcode = 'P0001';
  end if;
  n := jsonb_array_length(o.lines);
  if p_line is null or p_line < 0 or p_line >= n then
    raise exception 'Order % has no such line', o.token using errcode = 'P0001';
  end if;
  if p_count is null or p_count < 0 or p_count > (o.lines -> p_line ->> 'qty')::int then
    raise exception 'Order %: that is more than was ordered', o.token using errcode = 'P0001';
  end if;
  -- the counts so far, padded with zeros to one per line
  select coalesce(jsonb_agg(coalesce((o.given ->> i)::int, 0) order by i), '[]'::jsonb)
    into g from generate_series(0, n - 1) as i;
  g := jsonb_set(g, array[p_line::text], to_jsonb(p_count));
  update public.orders
     set given = g,
         status = case when status = 'new' then 'cooking' else status end,
         updated_at = now()
   where id = p_id
   returning * into o;
  return o;
end;
$$;
revoke execute on function public.set_given(uuid, int, int) from public, anon, authenticated;

insert into public.schema_migrations (name) values ('0008_given_ticks') on conflict (name) do nothing;
