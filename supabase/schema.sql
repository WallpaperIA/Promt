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
-- Limpieza de filas viejas. Correr cada tanto (pg_cron o a mano).
-- ─────────────────────────────────────────────────────────────
-- delete from free_usage where created_at < now() - interval '60 days';
-- delete from sessions   where expires_at < now();
