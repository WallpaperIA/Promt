begin;

create table public.user_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint user_settings_object check (jsonb_typeof(settings) = 'object'),
  constraint user_settings_size check (octet_length(settings::text) <= 650000)
);
alter table public.user_settings enable row level security;
revoke all on public.user_settings from public, anon, authenticated;
grant select, insert, update on public.user_settings to service_role;

-- Hasta diez versiones anteriores por cuenta, para recuperación. Ni esta
-- tabla ni la actual tienen acceso directo desde el navegador.
create table public.user_settings_history (
  user_id uuid not null references public.users(id) on delete cascade,
  revision integer not null check (revision > 0),
  settings jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (user_id, revision)
);
alter table public.user_settings_history enable row level security;
revoke all on public.user_settings_history from public, anon, authenticated;
grant select, insert, delete on public.user_settings_history to service_role;

create function public.respaldar_ajustes_cuenta() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.user_id <> old.user_id or new.revision <> old.revision + 1 then
    raise exception 'invalid_settings_revision' using errcode = '23514';
  end if;
  insert into public.user_settings_history(user_id, revision, settings)
    values (old.user_id, old.revision, old.settings);
  delete from public.user_settings_history h
    where h.user_id = old.user_id and h.revision not in (
      select revision from public.user_settings_history
      where user_id = old.user_id order by revision desc limit 10
    );
  return new;
end;
$$;
revoke all on function public.respaldar_ajustes_cuenta() from public, anon, authenticated;
grant execute on function public.respaldar_ajustes_cuenta() to service_role;
create trigger user_settings_backup before update on public.user_settings
  for each row execute function public.respaldar_ajustes_cuenta();

commit;
