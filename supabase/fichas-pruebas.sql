-- Se registran pruebas reales por variante, sin publicar el prompt o notas
-- internas. Editar el texto invalida la huella que comprueba el endpoint.
begin;
create table if not exists public.category_test_records (
  cat_id text not null references public.categories(id) on delete cascade,
  variant text not null check (variant in ('prompt','prompt2','duoPrompt','duoPrompt2','trioPrompt','trioPrompt2')),
  model text not null check (length(btrim(model)) between 1 and 80),
  model_version text not null check (length(btrim(model_version)) between 1 and 80),
  tested_on date not null,
  evidence_path text not null,
  body_hash text not null check (body_hash ~ '^[a-f0-9]{64}$'),
  primary key (cat_id, variant),
  foreign key (cat_id, evidence_path) references public.category_examples(cat_id, ruta) on delete cascade
);
alter table public.category_test_records enable row level security;
revoke all on public.category_test_records from public, anon, authenticated;
grant select, insert, update, delete on public.category_test_records to service_role;
-- Sin políticas públicas: acceso y firma de imágenes salen del servidor.
commit;
