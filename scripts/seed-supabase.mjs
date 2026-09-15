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
 *   … --dry-run     muestra qué haría sin escribir nada
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const CHUNK = 200;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!DRY && (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY en el entorno.');
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

  const categories = meta.map((c) => ({
    id: c.id,
    tier: c.tier || 'casual',
    sort_order: c.sortOrder,
    ready: c.ready !== false,
  }));

  const promptRows = bodies.map((b) => ({
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

  // Borrar lo que ya no está en la fuente, para que renombrar un id no deje huérfanos.
  const liveIds = new Set(categories.map((c) => c.id));
  const { data: existing, error: listErr } = await supabase.from('categories').select('id');
  if (listErr) throw new Error(`listando categorías: ${listErr.message}`);
  const stale = (existing || []).map((r) => r.id).filter((id) => !liveIds.has(id));
  if (stale.length) {
    const { error } = await supabase.from('categories').delete().in('id', stale);
    if (error) throw new Error(`borrando obsoletas: ${error.message}`);
    console.log(`Borradas ${stale.length} categorías obsoletas.`);
  }

  console.log('\n✓ Seed completo.');
}

main().catch((e) => {
  console.error('\n✗', e.message);
  process.exit(1);
});
