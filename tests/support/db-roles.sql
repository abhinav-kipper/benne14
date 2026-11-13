-- The roles a Supabase project comes with, for the integration test database (CI only).
-- `authenticator` is the login PostgREST uses; it switches to the role named in each request's key.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login password 'postgres' noinherit;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
