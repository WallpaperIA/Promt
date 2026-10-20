begin;

-- La API usa service_role. Las funciones nuevas tampoco deben convertirse
-- accidentalmente en RPC públicas por los permisos por defecto de Postgres.
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

create or replace function public.guardar_categoria_atomica(
  p_id text, p_campos jsonb, p_prompts jsonb default null, p_crear boolean default false
) returns void
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  anterior public.categories%rowtype;
  siguiente public.categories%rowtype;
begin
  if p_id is null or length(btrim(p_id)) not between 1 and 100
     or p_campos is null or jsonb_typeof(p_campos) <> 'object' then
    raise exception using errcode='22023', message='invalid_category';
  end if;
  if exists(select 1 from jsonb_object_keys(p_campos) k where k not in
    ('tier','name','sub','sort_order','ready','status','tested_at','tested_note','updated_at')) then
    raise exception using errcode='22023', message='invalid_fields';
  end if;
  if p_prompts is not null then
    if jsonb_typeof(p_prompts) <> 'object' then
      raise exception using errcode='22023', message='invalid_templates';
    end if;
    if exists(select 1 from jsonb_each(p_prompts) e where
      e.key not in ('prompt','prompt2','duoPrompt','duoPrompt2','trioPrompt','trioPrompt2')
      or jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 20000) then
      raise exception using errcode='22023', message='invalid_templates';
    end if;
  end if;

  if p_crear then
    siguiente := jsonb_populate_record(null::public.categories, p_campos);
    insert into public.categories(id,tier,name,sub,sort_order,ready,status,updated_at)
      values(p_id,siguiente.tier,siguiente.name,siguiente.sub,siguiente.sort_order,false,'borrador',now());
  else
    -- Serializar guardados de la misma escena evita mezclar su metadata con
    -- los textos de otro guardado mientras se reemplazan las variantes.
    select * into anterior from public.categories where id=p_id for update;
    if not found then raise exception using errcode='P0002', message='category_not_found'; end if;
    siguiente := jsonb_populate_record(anterior, p_campos);
    update public.categories set tier=siguiente.tier,name=siguiente.name,sub=siguiente.sub,
      tested_at=siguiente.tested_at,tested_note=siguiente.tested_note,status=siguiente.status,
      updated_at=now() where id=p_id;
  end if;
  if p_prompts is not null then
    delete from public.prompt_bodies where cat_id=p_id;
    insert into public.prompt_bodies(cat_id,variant,body)
      select p_id,key,btrim(value) from jsonb_each_text(p_prompts) where length(btrim(value)) > 0;
  end if;
  -- Cualquier error, incluso después del DELETE, revierte toda la llamada.
end;
$$;
revoke all on function public.guardar_categoria_atomica(text,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.guardar_categoria_atomica(text,jsonb,jsonb,boolean) to service_role;

create or replace function public.limitar_versiones_por_cuenta()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id then return new; end if;
  -- Un conteo en la API deja pasar tantos guardados como lleguen a la vez.
  -- El bloqueo vive hasta el commit y se separa por dueño, no por servidor.
  perform pg_advisory_xact_lock(hashtextextended('wallpaperia-versiones:' || new.user_id::text,0));
  if (select count(*) from public.prompt_versions where user_id=new.user_id) >= 100 then
    raise exception using errcode='P0001', message='version_limit';
  end if;
  return new;
end;
$$;
revoke all on function public.limitar_versiones_por_cuenta() from public,anon,authenticated;
grant execute on function public.limitar_versiones_por_cuenta() to service_role;
drop trigger if exists prompt_versions_limite_por_cuenta on public.prompt_versions;
create trigger prompt_versions_limite_por_cuenta before insert or update of user_id on public.prompt_versions
  for each row execute function public.limitar_versiones_por_cuenta();
commit;
