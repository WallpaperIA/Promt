-- Ejecutar antes de desplegar. Sólo guarda IDs de modificadores públicos,
-- nunca nombres, rasgos de personajes ni cuerpos de prompts.
begin;
do $$
declare tipo_usuario text;
begin
  select format_type(atttypid, atttypmod) into tipo_usuario from pg_attribute
    where attrelid = 'public.users'::regclass and attname = 'id' and not attisdropped;
  if tipo_usuario is null then raise exception 'Falta public.users.id'; end if;
  execute format($tabla$
    create table if not exists public.prompt_combinations (
      id uuid primary key default gen_random_uuid(),
      user_id %s not null references public.users(id) on delete cascade,
      title text not null check (length(btrim(title)) between 1 and 80),
      settings jsonb not null check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 4096),
      created_at timestamptz not null default now()
    )
  $tabla$, tipo_usuario);
end $$;
create index if not exists prompt_combinations_owner_idx on public.prompt_combinations (user_id, created_at desc, id desc);
alter table public.prompt_combinations enable row level security;
revoke all on public.prompt_combinations from public, anon, authenticated;
grant select, insert, update, delete on public.prompt_combinations to service_role;
-- Sin políticas: todas las consultas del handler filtran por el dueño de la sesión.
commit;
