begin;
-- Provocar un fallo DESPUÉS de borrar prueba el rollback real, no sólo la
-- validación previa de los parámetros.
create function public.fallar_insert_sintetico() returns trigger language plpgsql as $$
begin
  if new.body='FALLO_SINTETICO' then raise exception 'fallo_insert_sintetico'; end if;
  return new;
end $$;
create trigger fixture_fallo before insert on public.prompt_bodies for each row execute function public.fallar_insert_sintetico();
do $$
declare fallo boolean := false;
begin
  perform public.guardar_categoria_atomica('fixture-integridad','{"tier":"casual","name":"Antes","sort_order":0}', '{"prompt":"SINTETICO_ANTERIOR"}',true);
  begin
    perform public.guardar_categoria_atomica('fixture-integridad','{"tier":"hot","name":"Después"}', '{"prompt":"FALLO_SINTETICO"}',false);
  exception when raise_exception then
    if sqlerrm <> 'fallo_insert_sintetico' then raise; end if;
    fallo := true;
  end;
  if not fallo or not exists(select 1 from public.prompt_bodies where cat_id='fixture-integridad' and body='SINTETICO_ANTERIOR')
    or not exists(select 1 from public.categories where id='fixture-integridad' and tier='casual' and name='Antes') then
    raise exception 'No se restauró el guardado anterior';
  end if;
  perform public.guardar_categoria_atomica('fixture-integridad','{"name":"Renombrada"}',null,false);
  if not exists(select 1 from public.prompt_bodies where cat_id='fixture-integridad' and body='SINTETICO_ANTERIOR') then
    raise exception 'Renombrar borró variantes';
  end if;
  perform public.guardar_categoria_atomica('fixture-integridad','{}','{"duoPrompt":"SINTETICO_NUEVO"}',false);
  if exists(select 1 from public.prompt_bodies where cat_id='fixture-integridad' and variant='prompt')
    or not exists(select 1 from public.prompt_bodies where cat_id='fixture-integridad' and variant='duoPrompt') then
    raise exception 'Las variantes no se reemplazaron completas';
  end if;
  if has_function_privilege('anon','public.guardar_categoria_atomica(text,jsonb,jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.guardar_categoria_atomica(text,jsonb,jsonb,boolean)','EXECUTE') then
    raise exception 'La RPC quedó pública';
  end if;
end $$;
rollback;
