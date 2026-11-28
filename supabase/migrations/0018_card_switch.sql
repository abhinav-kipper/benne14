-- The owner's switch for taking cards at the kiosk (paid on the card machine at the counter). Off unless the owner turns it on.
alter table public.kiosk_settings add column if not exists card boolean not null default false;

insert into public.schema_migrations (name) values ('0018_card_switch') on conflict (name) do nothing;
