-- The owner's switch for taking cash at the kiosk. Off unless the owner turns it on.
alter table public.kiosk_settings add column if not exists cash boolean not null default false;

insert into public.schema_migrations (name) values ('0016_cash_switch') on conflict (name) do nothing;
