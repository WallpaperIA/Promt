-- Ejecutar antes de publicar la función y la página. Es independiente del
-- esquema histórico porque users y sessions ya existen fuera de schema.sql.
begin;

do $$
declare tipo_usuario text;
begin
  -- El repositorio no define users.id. Tomar su tipo real evita adivinar UUID
  -- o bigint y dejar una migración que no sirve en la base del proyecto.
  select format_type(atttypid, atttypmod) into tipo_usuario
    from pg_attribute
    where attrelid = 'public.users'::regclass and attname = 'id' and not attisdropped;
  if tipo_usuario is null then raise exception 'Falta public.users.id'; end if;
  execute format($tabla$
    create table if not exists public.prompt_versions (
      id uuid primary key default gen_random_uuid(),
      user_id %s not null references public.users(id) on delete cascade,
      cat_id text not null check (length(cat_id) between 1 and 100),
      variant text not null check (variant in ('prompt','prompt2','duoPrompt','duoPrompt2','trioPrompt','trioPrompt2')),
      title text not null check (length(btrim(title)) between 1 and 80),
      body text not null check (length(btrim(body)) between 1 and 20000),
      revision integer not null default 1 check (revision > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $tabla$, tipo_usuario);
end $$;

-- Una copia personal sobrevive a que se retire su escena del catálogo.
-- No lleva FK a categories, ni se escribe nunca en prompt_bodies.
create index if not exists prompt_versions_owner_idx
  on public.prompt_versions (user_id, created_at desc, id desc);
create index if not exists prompt_versions_owner_scene_idx
  on public.prompt_versions (user_id, cat_id, created_at desc, id desc);

alter table public.prompt_versions enable row level security;
revoke all on public.prompt_versions from public, anon, authenticated;
grant select, insert, update, delete on public.prompt_versions to service_role;

-- No crear políticas: el navegador no accede a esta tabla. Cada consulta de
-- /api/versiones debe filtrar por el dueño resuelto desde la sesión.
commit;
