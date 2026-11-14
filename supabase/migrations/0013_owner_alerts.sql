-- Alerts to the owner's phone: which phones asked for them, what is wrong right now (so each
-- problem is announced once, not every minute), and the key pair that signs the notifications.
-- Run in Supabase → SQL editor after 0012. Safe to run twice.

-- A phone (browser) that tapped "Turn on notifications" in the owner app.
create table if not exists public.push_subs (
  endpoint text primary key check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;

-- What is wrong now and what was. A row with no cleared_at is a problem that is still there.
create table if not exists public.alerts (
  key text primary key check (length(key) <= 120),
  level text not null check (level in ('bad', 'warn', 'info')),
  text text not null check (length(text) <= 200),
  hint text check (hint is null or length(hint) <= 300),
  first_at timestamptz not null default now(),
  cleared_at timestamptz
);
alter table public.alerts enable row level security;

-- Keys the app makes for itself and only the server may read (no policy: the browser keys cannot).
-- Holds the pair that signs notifications, made on first use so nothing has to be set up by hand.
create table if not exists public.app_keys (
  name text primary key check (length(name) <= 40),
  value text not null check (length(value) <= 500)
);
alter table public.app_keys enable row level security;
revoke all on public.app_keys from anon, authenticated;

insert into public.schema_migrations (name) values ('0013_owner_alerts') on conflict (name) do nothing;
