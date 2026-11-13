-- Run after the migrations. Mirrors Supabase's defaults: every role may touch public tables (row-level
-- security then decides what anon/authenticated actually see), and the server's role may call functions.
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to service_role;
