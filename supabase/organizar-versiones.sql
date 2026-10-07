-- Ejecutar primero mis-versiones.sql si la biblioteca todavía no está activa.
-- Son sólo etiquetas de copias personales: no se modifica el catálogo.
begin;
alter table public.prompt_versions add column if not exists folder text not null default '';
alter table public.prompt_versions add column if not exists tags text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.prompt_versions'::regclass and conname='prompt_versions_folder_length') then
    alter table public.prompt_versions add constraint prompt_versions_folder_length check (length(btrim(folder)) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.prompt_versions'::regclass and conname='prompt_versions_tags_count') then
    alter table public.prompt_versions add constraint prompt_versions_tags_count check (cardinality(tags) <= 8 and array_position(tags, null) is null);
  end if;
end $$;
alter table public.prompt_versions enable row level security;
revoke all on public.prompt_versions from public, anon, authenticated;
grant select, insert, update, delete on public.prompt_versions to service_role;
-- Sin políticas públicas: el handler conserva el filtro por dueño.
commit;
