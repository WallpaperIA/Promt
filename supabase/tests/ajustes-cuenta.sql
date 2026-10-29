-- Sólo datos sintéticos y transacción revertida, en Postgres desechable.
begin;
do $$
declare u uuid; h integer; valor jsonb;
begin
  insert into public.users(patreon_id) values ('fixture-ajustes') returning id into u;
  insert into public.user_settings(user_id,settings) values(u,'{"wp_style_v1":"original"}');
  for i in 2..15 loop
    update public.user_settings set settings=jsonb_build_object('wp_style_v1','sintetico-'||i),revision=i where user_id=u;
  end loop;
  select count(*) into h from public.user_settings_history where user_id=u;
  if h<>10 then raise exception 'Se esperaban 10 respaldos, hay %',h;end if;
  select settings into valor from public.user_settings_history where user_id=u and revision=14;
  if valor->>'wp_style_v1'<>'sintetico-14' then raise exception 'Respaldo incorrecto';end if;
  begin
    update public.user_settings set revision=revision where user_id=u;
    raise exception 'Se permitió una revisión inválida';
  exception when check_violation then null;
  end;
  update public.user_settings set revision=16,settings='{}' where user_id=u and revision=1;
  if found then raise exception 'La revisión vieja sobrescribió la actual';end if;
  begin
    insert into public.user_settings(user_id,settings) values(gen_random_uuid(),'{}');
    raise exception 'Se admitió un perfil sin cuenta';
  exception when foreign_key_violation then null;
  end;
  if exists(select 1 from pg_class where oid in('public.user_settings'::regclass,'public.user_settings_history'::regclass) and not relrowsecurity) then raise exception 'Falta RLS';end if;
  foreach valor in array array['"anon"'::jsonb,'"authenticated"'::jsonb] loop
    if has_table_privilege(valor#>>'{}','public.user_settings','SELECT')
      or has_table_privilege(valor#>>'{}','public.user_settings','INSERT')
      or has_table_privilege(valor#>>'{}','public.user_settings','UPDATE')
      or has_table_privilege(valor#>>'{}','public.user_settings_history','SELECT') then
      raise exception 'El navegador tiene privilegios sobre ajustes';
    end if;
  end loop;
  delete from public.users where id=u;
  if exists(select 1 from public.user_settings_history where user_id=u) or exists(select 1 from public.user_settings where user_id=u) then raise exception 'La cuenta borrada conserva datos';end if;
end $$;
rollback;
