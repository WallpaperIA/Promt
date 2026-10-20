-- Sólo para el Postgres desechable de CI. Nunca ejecutar en producción.
create role anon;
create role authenticated;
create role service_role bypassrls;
grant usage on schema public to service_role;
create table public.users(id uuid primary key default gen_random_uuid(),patreon_id text unique not null,tier text not null default 'free');
create table public.sessions(id uuid primary key default gen_random_uuid(),user_id uuid references public.users(id),token text,expires_at timestamptz);
\ir ../schema.sql
\ir ../mis-versiones.sql
