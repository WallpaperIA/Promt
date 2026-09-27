#!/usr/bin/env node
/**
 * Comprueba que la página y el servidor decidan igual quién abre qué.
 *
 * Si divergen, la página mostraría una categoría como libre y el servidor
 * devolvería 403, o —peor— al revés: un candado dibujado sobre algo que el
 * servidor entrega igual.
 *
 * La función del cliente se lee de index.html, no se copia: una copia a mano
 * es justo lo que termina desincronizado sin que nadie se entere.
 *
 * También cuida la lista GRATIS: que cada id exista y esté listo (si no, el
 * plan gratis promete cinco y da menos), y que ninguno sea xxx.
 *
 * Uso:  node scripts/verify-access.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { GRATIS, canAccess } from '../api/_access.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadCatalog() {
  const src = fs.readFileSync(path.join(ROOT, 'data', 'catalog.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  new vm.Script(src + ';globalThis.__out={CATEGORIES};').runInContext(sandbox);
  return sandbox.__out.CATEGORIES;
}

/** Saca canAccessCat de index.html contando llaves, y la deja evaluable. */
function clientCanAccessFactory() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ini = html.indexOf('function canAccessCat(cat){');
  if (ini === -1) throw new Error('No se encontró canAccessCat en index.html');
  let prof = 0, fin = -1;
  for (let i = html.indexOf('{', ini); i < html.length; i++) {
    if (html[i] === '{') prof++;
    else if (html[i] === '}' && --prof === 0) { fin = i + 1; break; }
  }
  const fuente = html.slice(ini, fin);
  // La lista se arma DENTRO del contexto: un Set creado afuera no es
  // instanceof del Set de adentro, y la función lo tomaría por ausente.
  return (tier, gratis) => {
    const sandbox = { currentAccessTier: tier, window: {}, __lista: gratis ? [...gratis] : null };
    vm.createContext(sandbox);
    new vm.Script(
      'if(__lista) window.__gratis = new Set(__lista);\n' + fuente + ';globalThis.__f=canAccessCat;'
    ).runInContext(sandbox);
    return sandbox.__f;
  };
}

function main() {
  const CATEGORIES = loadCatalog();
  const porId = new Map(CATEGORIES.map((c) => [c.id, c]));
  const fabrica = clientCanAccessFactory();
  const problemas = [];
  const avisos = [];
  let decisiones = 0;

  // La lista del plan gratis.
  for (const id of GRATIS) {
    const c = porId.get(id);
    if (!c) { problemas.push(`GRATIS: "${id}" no está en el catálogo`); continue; }
    if (c.ready === false) problemas.push(`GRATIS: "${id}" no está lista (ready:false)`);
    if (c.tier === 'xxx') problemas.push(`GRATIS: "${id}" es xxx; el plan gratis no puede abrir explícitas`);
    if (c.tier === 'hot') avisos.push(`GRATIS: "${id}" es hot`);
  }
  if (new Set(GRATIS).size !== GRATIS.length) problemas.push('GRATIS tiene ids repetidos');

  // Cada tier contra cada categoría, con la lista ya recibida.
  const gratis = new Set(GRATIS);
  const cuenta = {};
  for (const tier of ['free', 'premium', 'full']) {
    const cliente = fabrica(tier, gratis);
    cuenta[tier] = 0;
    for (const cat of CATEGORIES) {
      const s = canAccess(cat, tier).ok;
      const c = cliente(cat);
      decisiones++;
      if (s) cuenta[tier]++;
      if (s !== c) problemas.push(`tier=${tier} ${cat.id} (${cat.tier}): servidor=${s} página=${c}`);
    }
  }

  // Lo que promete la ventana de planes.
  const noXxx = CATEGORIES.filter((c) => c.tier !== 'xxx').length;
  const enCatalogo = GRATIS.filter((id) => porId.has(id)).length;
  if (cuenta.free !== enCatalogo) problemas.push(`free abre ${cuenta.free}, deberían ser ${enCatalogo}`);
  if (cuenta.premium !== noXxx) problemas.push(`premium abre ${cuenta.premium}, deberían ser ${noXxx} (todo menos xxx)`);
  if (cuenta.full !== CATEGORIES.length) problemas.push(`full abre ${cuenta.full} de ${CATEGORIES.length}`);

  // Sin la lista todavía, la página no dibuja candados para free: el
  // servidor decide. Que eso no cambie sin querer.
  const sinLista = fabrica('free', undefined);
  if (!CATEGORIES.every((c) => sinLista(c) === true)) {
    problemas.push('sin la lista de gratis, la página debería dejar decidir al servidor (true)');
  }

  for (const a of avisos) console.warn('  ⚠', a);
  if (problemas.length) {
    console.error(`\n✗ ${problemas.length} problemas:\n`);
    for (const p of problemas.slice(0, 15)) console.error('  -', p);
    if (problemas.length > 15) console.error(`  … y ${problemas.length - 15} más`);
    process.exit(1);
  }

  console.log(`\n✓ Página y servidor coinciden en ${decisiones.toLocaleString()} decisiones`);
  console.log(`  (${CATEGORIES.length} categorías × 3 tiers).`);
  console.log(`\n  free     ${cuenta.free}: ${GRATIS.join(', ')}`);
  console.log(`  premium  ${cuenta.premium}: todo menos xxx`);
  console.log(`  full     ${cuenta.full}: todo`);
}

main();
