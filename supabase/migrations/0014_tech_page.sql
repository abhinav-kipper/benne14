-- The technical page in the owner app: how long the important steps take, and how big the database
-- is. Run in Supabase → SQL editor after 0013. Safe to run twice.

-- One row each time the server places an order, moves one, or talks to the payment gateway (and
-- for anything that was slow). No customer details: a step's name, how long it took, did it work.
-- Old rows are trimmed by the app.
create table if not exists public.timings (
  id bigserial primary key,
  at timestamptz not null default now(),
  op text not null check (op ~ '^[a-z][a-z.]{1,31}$'),
  ms integer not null check (ms >= 0),
  ok boolean not null,
  build text check (build is null or length(build) <= 64)
);
create index if not exists timings_at on public.timings (at desc);
alter table public.timings enable row level security;
revoke all on public.timings from anon, authenticated;

-- The database's size and how many rows the growing tables hold, in one call.
create or replace function public.db_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'bytes', pg_database_size(current_database()),
    'orders', (select count(*) from public.orders),
    'order_events', (select count(*) from public.order_events),
    'admin_events', (select count(*) from public.admin_events),
    'error_log', (select count(*) from public.error_log),
    'timings', (select count(*) from public.timings),
    'first_order', (select min(created_at) from public.orders)
  );
$$;
revoke execute on function public.db_stats() from public, anon, authenticated;

insert into public.schema_migrations (name) values ('0014_tech_page') on conflict (name) do nothing;
