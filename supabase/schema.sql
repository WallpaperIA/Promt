-- Wallpaperia — esquema para el gating real de prompts.
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.

-- ─────────────────────────────────────────────────────────────
-- Catálogo: metadata que el servidor necesita para autorizar.
-- Duplica lo que hay en data/catalog.js, pero el servidor NUNCA confía
-- en lo que manda el cliente: la rotación semanal se calcula acá.
-- ─────────────────────────────────────────────────────────────
create table if not exists categories (
  id         text primary key,
  tier       text    not null check (tier in ('casual','editorial','hot','xxx')),
  sort_order int     not null,
  ready      boolean not null default true
);

create index if not exists categories_tier_order_idx
  on categories (tier, sort_order);

-- ─────────────────────────────────────────────────────────────
-- Los cuerpos de los prompts. Esto es el producto.
-- ─────────────────────────────────────────────────────────────
create table if not exists prompt_bodies (
  cat_id  text not null references categories(id) on delete cascade,
  variant text not null check (variant in
            ('prompt','prompt2','duoPrompt','duoPrompt2','trioPrompt','trioPrompt2')),
  body    text not null,
  primary key (cat_id, variant)
);

-- ─────────────────────────────────────────────────────────────
-- Uso semanal del tier free. Una fila por prompt distinto abierto:
-- re-abrir algo ya desbloqueado no vuelve a contar.
-- ─────────────────────────────────────────────────────────────
create table if not exists free_usage (
  bucket     text        not null,   -- token de sesión, o hash de IP si es anónimo
  week       int         not null,   -- mismo número de semana que usa el cliente
  cat_id     text        not null,
  created_at timestamptz not null default now(),
  primary key (bucket, week, cat_id)
);

create index if not exists free_usage_bucket_week_idx
  on free_usage (bucket, week);

-- ─────────────────────────────────────────────────────────────
-- RLS: sin políticas, así que ni anon ni authenticated leen nada.
-- Sólo service_role (que usan las funciones de /api) las atraviesa.
-- Si esto no está activo, la anon key deja leer todos los prompts.
-- ─────────────────────────────────────────────────────────────
alter table categories    enable row level security;
alter table prompt_bodies enable row level security;
alter table free_usage    enable row level security;

-- ─────────────────────────────────────────────────────────────
-- Consumo atómico del cupo free. Devuelve si se permite y cuánto lleva usado.
-- Va como función para que el chequeo y la inserción no puedan correr
-- intercalados entre dos pedidos simultáneos.
-- ─────────────────────────────────────────────────────────────
create or replace function consume_free_quota(
  p_bucket text,
  p_week   int,
  p_cat_id text,
  p_limit  int
)
returns table (allowed boolean, used int)
language plpgsql
security definer
as $$
declare
  v_used int;
  v_already boolean;
begin
  select exists (
    select 1 from free_usage
    where bucket = p_bucket and week = p_week and cat_id = p_cat_id
  ) into v_already;

  -- Ya lo había abierto esta semana: no se vuelve a cobrar.
  if v_already then
    select count(*) into v_used from free_usage where bucket = p_bucket and week = p_week;
    return query select true, v_used;
    return;
  end if;

  select count(*) into v_used from free_usage where bucket = p_bucket and week = p_week;

  if v_used >= p_limit then
    return query select false, v_used;
    return;
  end if;

  insert into free_usage (bucket, week, cat_id)
  values (p_bucket, p_week, p_cat_id)
  on conflict do nothing;

  select count(*) into v_used from free_usage where bucket = p_bucket and week = p_week;
  return query select true, v_used;
end;
$$;

revoke all on function consume_free_quota(text,int,text,int) from public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- Sincronización del tier con Patreon
--
-- Antes el tier sólo se calculaba al entrar, así que cancelar o cambiar de
-- plan no se notaba hasta el siguiente login: hasta 30 días de acceso a algo
-- que ya no se paga, o al revés, alguien que sube de plan y no lo recibe.
--
-- Guardar los tokens permite releer el tier sin que la persona vuelva a
-- entrar. Son credenciales: quedan protegidas por el RLS de users, que no
-- tiene políticas, así que sólo las lee service_role desde /api.
-- ─────────────────────────────────────────────────────────────
alter table users add column if not exists patreon_access_token     text;
alter table users add column if not exists patreon_refresh_token    text;
alter table users add column if not exists patreon_token_expires_at timestamptz;
alter table users add column if not exists tier_checked_at          timestamptz;

-- Cuenta de administración. La revalidación y el webhook la respetan, así que
-- el dueño del proyecto conserva acceso total sin tener que suscribirse a su
-- propia campaña. Se activa a mano; nada del flujo de Patreon la toca.
alter table users add column if not exists is_admin boolean not null default false;

-- ─────────────────────────────────────────────────────────────
-- Flujo de publicación de categorías
--
-- Una categoría nueva nace como 'borrador', pasa por 'prueba' cuando
-- supera las verificaciones automáticas, y sólo llega a 'publicada'
-- después de que el admin confirma que la probó de verdad.
--
-- El default es 'publicada' para que las 199 que ya existen no
-- desaparezcan al correr esto.
-- ─────────────────────────────────────────────────────────────
alter table categories add column if not exists status text not null default 'publicada';
alter table categories add column if not exists name  text;
alter table categories add column if not exists sub   text;

-- Registro de la prueba manual: qué se probó y cuándo.
alter table categories add column if not exists tested_at   timestamptz;
alter table categories add column if not exists tested_note text;

alter table categories add column if not exists created_at timestamptz not null default now();
alter table categories add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'categories_status_valido') then
    alter table categories add constraint categories_status_valido
      check (status in ('borrador','prueba','publicada'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Lápidas: ids que el admin eliminó para siempre.
--
-- Borrar la fila de categories no alcanza. Las 199 originales también
-- viven en data/catalog.js, el archivo estático que baja cada visitante:
-- sin esta lista seguirían apareciendo en la lista y fallarían al abrirse.
-- Y el próximo `npm run seed` las volvería a insertar desde
-- data/prompts.js, que no se toca.
--
-- Entonces queda el id, y nada más: los prompts se borran de verdad.
-- /api/catalog devuelve esta lista para que el navegador las saque, y el
-- seed saltea estos ids.
-- ─────────────────────────────────────────────────────────────
create table if not exists deleted_categories (
  id         text primary key,
  deleted_at timestamptz not null default now()
);

alter table deleted_categories enable row level security;

-- El endpoint público filtra por estado; el delta ordena por updated_at.
create index if not exists categories_status_idx on categories (status);
create index if not exists categories_updated_idx on categories (updated_at);

-- El webhook busca por patreon_id en cada evento.
create index if not exists users_patreon_id_idx on users (patreon_id);

-- verify.js resuelve la sesión por token en cada carga de página.
create index if not exists sessions_token_idx on sessions (token);

-- Que no entre un tier inventado por un cambio manual a mano.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_tier_valido') then
    alter table users add constraint users_tier_valido
      check (tier in ('free','premium','full'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Limpieza de filas viejas. Correr cada tanto (pg_cron o a mano).
-- ─────────────────────────────────────────────────────────────
-- delete from free_usage where created_at < now() - interval '60 days';
-- delete from sessions   where expires_at < now();

-- ─────────────────────────────────────────────────────────────
-- Imágenes de ejemplo de cada categoría.
--
-- Vende mejor que cualquier texto: el que llega tiene que poder ver qué
-- genera el prompt antes de pagar. Sólo algunas categorías destacadas las
-- tienen; el resto simplemente no muestra nada.
--
-- Acá va SÓLO la referencia. El archivo vive en Supabase Storage, en el
-- bucket "ejemplos", que tiene que quedar PRIVADO: las de tier hot y xxx no
-- pueden tener una URL abierta e indexable. El servidor firma una URL
-- temporal después de comprobar el tier, igual que con los prompts.
-- ─────────────────────────────────────────────────────────────
create table if not exists category_examples (
  cat_id     text not null references categories(id) on delete cascade,
  ruta       text not null,              -- ruta dentro del bucket
  orden      int  not null default 0,
  created_at timestamptz not null default now(),
  primary key (cat_id, ruta)
);

create index if not exists category_examples_cat_idx
  on category_examples (cat_id, orden);

alter table category_examples enable row level security;

-- ─────────────────────────────────────────────────────────────
-- Permisos de la Data API
--
-- Desde el 30/10/2026 Supabase no le da acceso automático a la API a las
-- tablas NUEVAS de public. Sin un GRANT explícito la tabla queda inaccesible
-- y /api contesta "permission denied": las funciones entran con service_role,
-- que también necesita el permiso. Las tablas que ya existían no cambian,
-- pero este archivo se corre entero en un proyecto nuevo, y ahí sin esto no
-- arranca nada.
--
-- Sólo service_role. El ejemplo que manda Supabase incluye anon y
-- authenticated: acá no van. El RLS sin políticas ya los frena, pero el
-- permiso de tabla deja el catálogo a un `disable row level security` de
-- distancia, que es exactamente la falla que la regla 3 viene a evitar. Con
-- el revoke hacen falta las dos cosas para que se escape algo. Ningún camino
-- usa la anon key: el navegador habla con /api y nada más.
--
-- Va como bucle y no tabla por tabla a propósito: users y sessions no se
-- crean en este archivo, y así una tabla nueva queda cubierta con sólo
-- volver a correrlo, sin que haya que acordarse de agregarla acá.
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('grant all on table public.%I to service_role', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
