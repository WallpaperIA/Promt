-- Sólo para el Postgres desechable de CI. Nunca ejecutar en producción.
create role anon;
create role authenticated;
create role service_role bypassrls;
grant usage on schema public to service_role;
-- users y sessions salen de schema.sql: así se prueba la definición real.
\ir ../schema.sql
\ir ../mis-versiones.sql
