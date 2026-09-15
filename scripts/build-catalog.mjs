#!/usr/bin/env node
/**
 * Parte data/prompts.js en dos:
 *
 *   data/catalog.js        metadata pública (id, tier, name, sub, ready) +
 *                          STYLES/OUTFITS/FORMATS/DETAILS. Se publica en Pages.
 *   build/prompts.seed.json  los cuerpos de los prompts. NO se publica:
 *                          se cargan en Supabase con scripts/seed-supabase.mjs.
 *
 * Los cuerpos se extraen EJECUTANDO cada función con valores centinela, en vez
 * de parsear el JS. Algunas funciones tienen cuerpo de bloque y llaman a
 * getCharData(), así que evaluarlas es lo único que captura el texto final de
 * forma fiable.
 *
 * Centinelas que quedan en el template guardado:
 *   __N__ __N1__ __N2__ __N3__                  nombres
 *   __N_HAIR__ __N_FEATURES__ (y N1/N2/N3)      datos del personaje
 *
 * El cliente los reemplaza al renderizar (renderPromptTemplate en index.html),
 * así que los nombres y datos de personajes nunca salen del navegador.
 *
 * Uso:  node scripts/build-catalog.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'prompts.js');
const OUT_CATALOG = path.join(ROOT, 'data', 'catalog.js');
const OUT_SEED = path.join(ROOT, 'build', 'prompts.seed.json');

/** Variantes de prompt y con cuántos nombres se invoca cada una. */
const VARIANTS = {
  prompt: 1,
  prompt2: 1,
  duoPrompt: 2,
  duoPrompt2: 2,
  trioPrompt: 3,
  trioPrompt2: 3,
};

const ARGS = {
  1: ['__N__'],
  2: ['__N1__', '__N2__'],
  3: ['__N1__', '__N2__', '__N3__'],
};

/** Stub de getCharData: devuelve centinelas derivados del nombre recibido. */
function getCharDataStub(n) {
  const m = String(n).match(/^__(N[123]?)__$/);
  const tag = m ? m[1] : 'N';
  return { hair: `__${tag}_HAIR__`, features: `__${tag}_FEATURES__` };
}

function loadData() {
  const source = fs.readFileSync(SRC, 'utf8');
  const sandbox = { getCharData: getCharDataStub, console };
  vm.createContext(sandbox);
  // Los arrays se declaran con `const` a nivel top, así que no aparecen como
  // propiedades del contexto: hay que exportarlos explícitamente.
  const exportLine =
    ';globalThis.__out = { CATEGORIES, STYLES, OUTFITS, FORMATS, DETAILS };';
  new vm.Script(source + exportLine, { filename: 'prompts.js' }).runInContext(sandbox);
  return sandbox.__out;
}

function main() {
  const { CATEGORIES, STYLES, OUTFITS, FORMATS, DETAILS } = loadData();
  if (!Array.isArray(CATEGORIES) || !CATEGORIES.length) {
    throw new Error('No se pudo leer CATEGORIES desde data/prompts.js');
  }

  const meta = [];
  const bodies = [];
  const problems = [];

  CATEGORIES.forEach((cat, index) => {
    // Metadata = todo lo que no sea una de las funciones de prompt.
    const entry = { sortOrder: index };
    for (const [key, value] of Object.entries(cat)) {
      if (!(key in VARIANTS)) entry[key] = value;
    }
    if (!entry.id) throw new Error(`Categoría ${index} sin id`);
    // Qué variantes existen. El cliente lo necesita para decidir si dibuja
    // las pestañas de Dúo y Trío ANTES de haber descargado ningún cuerpo.
    entry.variants = Object.keys(VARIANTS).filter((v) => typeof cat[v] === 'function');
    meta.push(entry);

    for (const [variant, arity] of Object.entries(VARIANTS)) {
      const fn = cat[variant];
      if (typeof fn !== 'function') continue;
      let body;
      try {
        body = fn(...ARGS[arity]);
      } catch (e) {
        problems.push(`${entry.id}.${variant}: ${e.message}`);
        continue;
      }
      if (typeof body !== 'string' || !body.trim()) {
        problems.push(`${entry.id}.${variant}: no devolvió texto`);
        continue;
      }
      bodies.push({
        cat_id: entry.id,
        variant,
        tier: cat.tier || 'casual',
        body,
      });
    }
  });

  if (problems.length) {
    console.error('\nProblemas extrayendo prompts:');
    for (const p of problems) console.error('  -', p);
    throw new Error(`${problems.length} prompts no se pudieron extraer`);
  }

  // Sanidad: ningún cuerpo debe quedar con interpolación sin resolver, y todo
  // centinela emitido tiene que ser uno de los conocidos.
  const KNOWN = /^__N[123]?(_HAIR|_FEATURES)?__$/;
  for (const b of bodies) {
    if (b.body.includes('${')) {
      throw new Error(`${b.cat_id}.${b.variant}: quedó un \${...} sin resolver`);
    }
    for (const token of b.body.match(/__[A-Z0-9_]+__/g) || []) {
      if (!KNOWN.test(token)) {
        throw new Error(`${b.cat_id}.${b.variant}: centinela inesperado ${token}`);
      }
    }
  }

  const catalogJs =
    `// GENERADO POR scripts/build-catalog.mjs — no editar a mano.\n` +
    `// Fuente: data/prompts.js. Los cuerpos de los prompts viven en Supabase\n` +
    `// y se piden a /api/prompt según el tier del usuario.\n` +
    // Sello de compilación: el cliente le pide a /api/catalog sólo lo
    // creado o editado después de este momento.
    `const CATALOG_BUILT_AT = ${JSON.stringify(new Date().toISOString())};\n` +
    // Sin indentar: lo baja cada visitante.
    `const CATEGORIES = ${JSON.stringify(meta)};\n` +
    `const STYLES = ${JSON.stringify(STYLES)};\n` +
    `const OUTFITS = ${JSON.stringify(OUTFITS)};\n` +
    `const FORMATS = ${JSON.stringify(FORMATS)};\n` +
    `const DETAILS = ${JSON.stringify(DETAILS)};\n`;

  fs.mkdirSync(path.dirname(OUT_SEED), { recursive: true });
  fs.writeFileSync(OUT_CATALOG, catalogJs);
  fs.writeFileSync(OUT_SEED, JSON.stringify(bodies, null, 1));

  const srcBytes = fs.statSync(SRC).size;
  const catBytes = fs.statSync(OUT_CATALOG).size;
  const seedBytes = fs.statSync(OUT_SEED).size;
  const pct = (n) => ((n / srcBytes) * 100).toFixed(1);

  console.log(`\nCategorías:       ${meta.length}`);
  console.log(`Cuerpos:          ${bodies.length}`);
  console.log(`\nprompts.js        ${srcBytes.toLocaleString()} bytes`);
  console.log(`catalog.js        ${catBytes.toLocaleString()} bytes  (${pct(catBytes)}% — público)`);
  console.log(`prompts.seed.json ${seedBytes.toLocaleString()} bytes  (${pct(seedBytes)}% — a Supabase)`);

  const byTier = {};
  for (const m of meta) byTier[m.tier] = (byTier[m.tier] || 0) + 1;
  console.log('\nPor tier:', byTier);
}

main();
