#!/usr/bin/env node
/**
 * Carga el catálogo y los cuerpos de los prompts en Supabase.
 *
 * Requiere (ejecutar antes scripts/build-catalog.mjs):
 *   SUPABASE_URL          https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role key — NUNCA en el cliente
 *
 * Uso:
 *   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/seed-supabase.mjs
 *   … --dry-run             muestra qué haría sin escribir nada
 *   … --borrar-obsoletas    borra de Supabase lo que no esté en la fuente.
 *                           NO usar si hay categorías creadas desde el panel:
 *                           esas viven sólo en Supabase y se perderían.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const BORRAR = process.argv.includes('--borrar-obsoletas');
const CHUNK = 200;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!DRY && (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY en el entorno.');
  process.exit(1);
}

// Pegar el texto de ejemplo en vez de la clave pasa, y Supabase sólo contesta
// "Invalid API key" recién después de leer y procesar los 1188 prompts. Una
// service_role key es un JWT: tres partes separadas por punto, empieza con eyJ.
if (!DRY && !/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(SUPABASE_SERVICE_KEY.trim())) {
  console.error('\nSUPABASE_SERVICE_KEY no parece una clave de Supabase.');
  console.error(`Recibido: "${SUPABASE_SERVICE_KEY.slice(0, 28)}${SUPABASE_SERVICE_KEY.length > 28 ? '…' : ''}"`);
  console.error('\nLa service_role está en Supabase → Project Settings → API Keys.');
  console.error('Es un texto largo que empieza con eyJ y tiene dos puntos separadores.');
  console.error('Ojo: la anon no sirve, y esas variables se borran al cerrar la terminal.\n');
  process.exit(1);
}

if (!DRY && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL.trim())) {
  console.error(`\nSUPABASE_URL no parece correcta: "${SUPABASE_URL}"`);
  console.error('Tiene que ser https://TUPROYECTO.supabase.co, sin /rest/v1 al final.\n');
  process.exit(1);
}

function loadCatalogMeta() {
  const src = fs.readFileSync(path.join(ROOT, 'data', 'catalog.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  new vm.Script(src + ';globalThis.__out={CATEGORIES};').runInContext(sandbox);
  return sandbox.__out.CATEGORIES;
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const seedPath = path.join(ROOT, 'build', 'prompts.seed.json');
  if (!fs.existsSync(seedPath)) {
    console.error('No existe build/prompts.seed.json — corré antes: node scripts/build-catalog.mjs');
    process.exit(1);
  }

  const meta = loadCatalogMeta();
  const bodies = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  let categories = meta.map((c) => ({
    id: c.id,
    tier: c.tier || 'casual',
    sort_order: c.sortOrder,
    ready: c.ready !== false,
    // name y sub se agregaron con el flujo de publicación. Sin esto quedaban
    // en null y /api/catalog devolvía el delta entero con los nombres vacíos:
    // el cliente los conservaba del archivo estático, pero eran 30 KB al
    // pedo en cada visita.
    name: c.name ?? null,
    sub: c.sub ?? null,
  }));

  let promptRows = bodies.map((b) => ({
    cat_id: b.cat_id,
    variant: b.variant,
    body: b.body,
  }));

  console.log(`Categorías:  ${categories.length}`);
  console.log(`Cuerpos:     ${promptRows.length}`);

  if (DRY) {
    console.log('\n--dry-run: no se escribió nada.');
    console.log('Ejemplo de categoría:', categories[0]);
    console.log('Ejemplo de cuerpo:', {
      ...promptRows[0],
      body: promptRows[0].body.slice(0, 80) + '…',
    });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Lo que el admin eliminó para siempre desde la papelera no se vuelve a
  // subir. data/prompts.js no se toca al borrar —es la fuente— así que sin
  // esto cada seed resucitaría lo borrado.
  const { data: lapidas, error: lapErr } = await supabase.from('deleted_categories').select('id');
  if (lapErr) throw new Error(`leyendo eliminadas: ${lapErr.message}`);
  const eliminadas = new Set((lapidas || []).map((r) => r.id));
  if (eliminadas.size) {
    const omitidas = categories.filter((c) => eliminadas.has(c.id)).map((c) => c.id);
    categories = categories.filter((c) => !eliminadas.has(c.id));
    promptRows = promptRows.filter((r) => !eliminadas.has(r.cat_id));
    if (omitidas.length) {
      console.log(`\nEliminadas por el admin, no se suben: ${omitidas.join(', ')}`);
      console.log(`Quedan ${categories.length} categorías y ${promptRows.length} cuerpos.`);
      console.log('Para revivir alguna: delete from deleted_categories where id = \'...\';\n');
    }
  }

  // Las categorías primero: prompt_bodies las referencia por FK.
  for (const [i, batch] of chunks(categories, CHUNK).entries()) {
    const { error } = await supabase.from('categories').upsert(batch, { onConflict: 'id' });
    if (error) throw new Error(`categories lote ${i + 1}: ${error.message}`);
    process.stdout.write(`\rCategorías: ${Math.min((i + 1) * CHUNK, categories.length)}/${categories.length}`);
  }
  console.log();

  for (const [i, batch] of chunks(promptRows, CHUNK).entries()) {
    const { error } = await supabase
      .from('prompt_bodies')
      .upsert(batch, { onConflict: 'cat_id,variant' });
    if (error) throw new Error(`prompt_bodies lote ${i + 1}: ${error.message}`);
    process.stdout.write(`\rCuerpos: ${Math.min((i + 1) * CHUNK, promptRows.length)}/${promptRows.length}`);
  }
  console.log();

  // Lo que está en Supabase y no en la fuente. Antes se borraba solo, para que
  // renombrar un id no dejara huérfanos. Desde que existe el panel eso es
  // peligroso: una categoría creada desde el navegador vive SÓLO en Supabase,
  // no en data/prompts.js, así que el seed la veía como obsoleta y la borraba.
  // Ahora hay que pedirlo con --borrar-obsoletas, y se listan antes.
  const liveIds = new Set(categories.map((c) => c.id));
  const { data: existing, error: listErr } = await supabase.from('categories').select('id');
  if (listErr) throw new Error(`listando categorías: ${listErr.message}`);
  const stale = (existing || []).map((r) => r.id).filter((id) => !liveIds.has(id));
  if (stale.length) {
    console.log(`\nHay ${stale.length} categorías en Supabase que no están en la fuente:`);
    for (const id of stale) console.log('  -', id);
    if (BORRAR) {
      const { error } = await supabase.from('categories').delete().in('id', stale);
      if (error) throw new Error(`borrando obsoletas: ${error.message}`);
      console.log(`Borradas ${stale.length}.`);
    } else {
      console.log('No se borró ninguna. Si de verdad sobran, correr con --borrar-obsoletas.');
      console.log('Ojo: las creadas desde el panel viven sólo acá y aparecen en esta lista.');
    }
  }

  console.log('\n✓ Seed completo.');
}

main().catch((e) => {
  console.error('\n✗', e.message);
  // exitCode y no exit(): cortar el proceso con sockets abiertos hace que
  // Node en Windows escupa un "Assertion failed: UV_HANDLE_CLOSING" después
  // del error, que no aporta nada y tapa el mensaje que sí importa.
  process.exitCode = 1;
});
