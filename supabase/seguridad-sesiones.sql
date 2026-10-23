begin;
-- Cambios compatibles con la API actual: no cierran sesiones ni recalculan planes.
-- Se puede volver a ejecutar: cada paso comprueba antes de cambiar.
alter table public.users add column if not exists patreon_campaign_id text;

-- La API nueva guarda en sessions.token el SHA-256 de la cookie: 64
-- caracteres hexadecimales. La tabla no está en schema.sql y los tokens
-- viejos eran UUID: si la columna fuera uuid o varchar corto, el insert del
-- hash fallaría y nadie podría entrar. Pasarla a text no cambia nada para la
-- API anterior, que guarda y busca el UUID como texto.
do $$
declare tipo text;
begin
  select format_type(atttypid, atttypmod) into tipo
    from pg_attribute
    where attrelid = 'public.sessions'::regclass and attname = 'token' and not attisdropped;
  if tipo is null then raise exception 'Falta public.sessions.token'; end if;
  if tipo <> 'text' then
    raise notice 'sessions.token era %, pasa a text', tipo;
    execute 'alter table public.sessions alter column token type text using token::text';
  end if;
end $$;
do $$
declare t text;
begin
  foreach t in array array['categories','category_examples','deleted_categories','free_usage','prompt_bodies','prompt_versions','sessions','users']
  loop
    if to_regclass('public.' || t) is null then raise exception 'Falta tabla privada: %', t; end if;
    if exists(select 1 from pg_policies where schemaname='public' and tablename=t) then
      raise exception 'Revisar políticas inesperadas antes de continuar: %', t;
    end if;
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
  end loop;
end $$;
revoke create on schema public from public, anon, authenticated;
alter function public.consume_free_quota(text,int,text,int) set search_path = public, pg_temp;
revoke all on function public.consume_free_quota(text,int,text,int) from public, anon, authenticated;
update storage.buckets set public=false, file_size_limit=3145728,
 allowed_mime_types=array['image/webp','image/jpeg','image/png']
 where id='ejemplos';
commit;
