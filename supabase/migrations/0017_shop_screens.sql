-- Which of the devices seen is the shop's own kiosk, kitchen tablet or TV. Only those are listed
-- on the owner app's System page and watched for going silent; phones and test links are not.
alter table public.devices add column if not exists shop boolean not null default false;

insert into public.schema_migrations (name) values ('0017_shop_screens') on conflict (name) do nothing;
