-- Watching the system: which screens are alive, and what went wrong. Shown on the owner app's
-- System page. Run in Supabase → SQL editor after 0011. Safe to run twice.

-- One row per screen in the shop (a tablet, the TV, the owner's phone). Each says "I'm here" every
-- half minute; a screen that has gone quiet is a screen that is off, asleep or offline.
create table if not exists public.devices (
  id text primary key check (id ~ '^[a-z0-9]{8,24}$'),
  kind text not null check (kind in ('kiosk', 'kitchen', 'board', 'owner')),
  screen text check (screen is null or length(screen) <= 24),   -- what it is showing: "home", "cart"…
  build text check (build is null or length(build) <= 64),      -- the version it is running
  first_seen timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
create index if not exists devices_seen on public.devices (seen_at desc);
alter table public.devices enable row level security;

-- Errors from the screens and the server, newest first. No customer details: a message, where it
-- happened and the version. Old rows are trimmed by the app.
create table if not exists public.error_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  source text not null check (source in ('kiosk', 'kitchen', 'board', 'owner', 'bill', 'server')),
  message text not null check (length(message) between 1 and 300),
  detail text check (detail is null or length(detail) <= 2000),
  build text check (build is null or length(build) <= 64),
  device text check (device is null or length(device) <= 24)
);
create index if not exists error_log_at on public.error_log (at desc);
alter table public.error_log enable row level security;

insert into public.schema_migrations (name) values ('0012_system_watch') on conflict (name) do nothing;
