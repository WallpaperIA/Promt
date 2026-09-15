#!/usr/bin/env node
/**
 * Verifica que la extracción no cambió ni un carácter.
 *
 * Para cada categoría y variante compara:
 *   original:  la función de data/prompts.js llamada con nombres reales
 *   extraído:  el template de build/prompts.seed.json pasado por el mismo
 *              renderer que usa el cliente
 *
 * Si algo difiere, la migración a Supabase cambiaría prompts en producción.
 *
 * Uso:  node scripts/verify-catalog.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Personajes de prueba: nombres con caracteres que podrían romper el reemplazo.
const CHARS = {
  'Ana Sofía': { hair: 'long auburn hair', features: 'green eyes, freckles' },
  'Mia-Rose': { hair: 'platinum blonde bob', features: 'sharp cheekbones' },
  'Zoé $1 O\'Hara': { hair: 'jet black waves', features: 'olive skin' },
};
const NAMES = Object.keys(CHARS);
const DEFAULT_CHAR = { hair: 'hair', features: 'natural features' };

const getCharData = (name) => CHARS[name] || DEFAULT_CHAR;

/**
 * Misma lógica que renderPromptTemplate() en index.html.
 * Si cambia una, tiene que cambiar la otra.
 */
function renderPromptTemplate(tpl, names) {
  return String(tpl).replace(
    /__N([123]?)(_HAIR|_FEATURES)?__/g,
    (_m, idx, field) => {
      const name = names[idx ? Number(idx) - 1 : 0];
      if (name === undefined) return '';
      if (!field) return name;
      const d = getCharData(name);
      return field === '_HAIR' ? d.hair : d.features;
    }
  );
}

const VARIANTS = { prompt: 1, prompt2: 1, duoPrompt: 2, duoPrompt2: 2, trioPrompt: 3, trioPrompt2: 3 };

function loadOriginal() {
  const source = fs.readFileSync(path.join(ROOT, 'data', 'prompts.js'), 'utf8');
  const sandbox = { getCharData, console };
  vm.createContext(sandbox);
  new vm.Script(source + ';globalThis.__out={CATEGORIES};').runInContext(sandbox);
  return sandbox.__out.CATEGORIES;
}

function main() {
  const CATEGORIES = loadOriginal();
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'prompts.seed.json'), 'utf8'));
  const byKey = new Map(seed.map((r) => [`${r.cat_id}|${r.variant}`, r.body]));

  let checked = 0;
  const mismatches = [];

  for (const cat of CATEGORIES) {
    for (const [variant, arity] of Object.entries(VARIANTS)) {
      const fn = cat[variant];
      const tpl = byKey.get(`${cat.id}|${variant}`);

      if (typeof fn !== 'function') {
        if (tpl !== undefined) mismatches.push(`${cat.id}.${variant}: sobra en el seed`);
        continue;
      }
      if (tpl === undefined) {
        mismatches.push(`${cat.id}.${variant}: falta en el seed`);
        continue;
      }

      const names = NAMES.slice(0, arity);
      const expected = fn(...names);
      const actual = renderPromptTemplate(tpl, names);
      checked++;

      if (expected !== actual) {
        let at = 0;
        while (at < expected.length && expected[at] === actual[at]) at++;
        mismatches.push(
          `${cat.id}.${variant}: difiere en la posición ${at}\n` +
          `    esperado: ${JSON.stringify(expected.slice(at - 40 < 0 ? 0 : at - 40, at + 40))}\n` +
          `    obtenido: ${JSON.stringify(actual.slice(at - 40 < 0 ? 0 : at - 40, at + 40))}`
        );
      }
    }
  }

  // El seed no debe contener nombres de prueba filtrados desde la extracción.
  for (const row of seed) {
    for (const n of NAMES) {
      if (row.body.includes(n)) mismatches.push(`${row.cat_id}.${row.variant}: contiene un nombre de prueba`);
    }
  }

  if (mismatches.length) {
    console.error(`\n✗ ${mismatches.length} diferencias sobre ${checked} prompts:\n`);
    for (const m of mismatches.slice(0, 20)) console.error('  -', m);
    if (mismatches.length > 20) console.error(`  … y ${mismatches.length - 20} más`);
    process.exit(1);
  }

  console.log(`\n✓ ${checked} prompts idénticos byte a byte tras el round-trip.`);
  console.log(`  Probado con ${NAMES.length} nombres, incluyendo acentos, guiones,`);
  console.log(`  apóstrofes y "$1" (que rompería un replace mal escrito).`);
}

main();
