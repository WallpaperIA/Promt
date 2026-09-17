#!/usr/bin/env node
/**
 * Salud del catálogo de prompts. No comprueba formato —de eso se encarga
 * api/_validar.js— sino defectos de contenido que el formato no ve.
 *
 * Busca tres cosas:
 *
 *   relativa    el texto remite a otro ("same scene as above"). Cada variante
 *               se sirve sola: lo que quede sin describir no llega.
 *   repetida    el mismo cuerpo exacto en más de una categoría. Elegir dos
 *               escenas distintas y recibir el mismo prompt es lo peor que
 *               puede pasarle a un suscriptor que paga por variedad.
 *   sin-nombre  un dúo o trío que no menciona a todas las personas.
 *
 * El catálogo arrastra defectos de antes, así que esto NO falla por lo ya
 * conocido: compara contra prompts-baseline.json y sólo corta si aparece algo
 * nuevo. Así la deuda no crece y el archivo se va achicando a medida que se
 * arreglan. Cuando quede vacío, se puede borrar junto con esta salvedad.
 *
 *   node scripts/verify-prompts.mjs                 comprueba
 *   node scripts/verify-prompts.mjs --actualizar    reescribe la línea base
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(ROOT, 'scripts', 'prompts-baseline.json');
const ACTUALIZAR = process.argv.includes('--actualizar');

const RELATIVAS = /\b(?:same (?:scene|pose|setting|outfit|lighting)[^.]{0,40}\bas above|as (?:described |shown )?above|as (?:in|per) the (?:previous|first) (?:prompt|version))\b/i;
const NOMBRES = { duoPrompt: 2, duoPrompt2: 2, trioPrompt: 3, trioPrompt2: 3 };

const seedPath = path.join(ROOT, 'build', 'prompts.seed.json');
if (!fs.existsSync(seedPath)) {
  console.error('No existe build/prompts.seed.json — corré antes: npm run build:catalog');
  process.exit(1);
}
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const hallazgos = [];
const porCuerpo = new Map();
for (const r of seed) {
  const clave = `${r.cat_id}.${r.variant}`;
  if (RELATIVAS.test(r.body)) hallazgos.push({ clave, tipo: 'relativa' });
  const n = NOMBRES[r.variant];
  if (n) {
    for (let i = 1; i <= n; i++) {
      if (!r.body.includes(`__N${i}__`)) {
        hallazgos.push({ clave, tipo: 'sin-nombre' });
        break;
      }
    }
  }
  if (!porCuerpo.has(r.body)) porCuerpo.set(r.body, []);
  porCuerpo.get(r.body).push(r);
}
for (const filas of porCuerpo.values()) {
  const cats = new Set(filas.map((f) => f.cat_id));
  if (cats.size < 2) continue; // repetir dentro de una misma categoría es válido
  for (const f of filas) hallazgos.push({ clave: `${f.cat_id}.${f.variant}`, tipo: 'repetida' });
}

const actuales = new Set(hallazgos.map((h) => `${h.tipo}:${h.clave}`));

if (ACTUALIZAR) {
  fs.writeFileSync(BASE, JSON.stringify([...actuales].sort(), null, 1) + '\n');
  console.log(`Línea base reescrita: ${actuales.size} defectos conocidos.`);
  process.exit(0);
}

const conocidos = new Set(fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : []);
const nuevos = [...actuales].filter((k) => !conocidos.has(k));
const resueltos = [...conocidos].filter((k) => !actuales.has(k));

const cuenta = (t) => hallazgos.filter((h) => h.tipo === t).length;
console.log('\n════ SALUD DEL CATÁLOGO ════');
console.log(`  ${actuales.size} defectos: relativas ${cuenta('relativa')} · repetidas ${cuenta('repetida')} · sin nombre ${cuenta('sin-nombre')}`);
if (resueltos.length) {
  console.log(`  ✓ ${resueltos.length} arreglados desde la última línea base`);
  console.log('    correr con --actualizar para dejarlo asentado');
}
if (!nuevos.length) console.log('  ✓ ninguno nuevo');

if (nuevos.length) {
  console.error(`\n✗ ${nuevos.length} defectos NUEVOS:`);
  for (const k of nuevos.slice(0, 15)) console.error('  -', k);
  if (nuevos.length > 15) console.error(`  … y ${nuevos.length - 15} más`);
  console.error('\nCada variante se guarda y se sirve sola: la escena tiene que estar');
  console.error('descrita entera en cada una, sin remitir a ningún otro texto.');
  process.exit(1);
}
