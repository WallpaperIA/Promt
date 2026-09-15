#!/usr/bin/env node
/**
 * Compara la lógica de acceso del servidor (api/_access.js) contra la
 * implementación original del cliente, sobre el catálogo real y a lo largo
 * de 200 semanas.
 *
 * Si divergen, el cliente mostraría una categoría como libre y el servidor
 * devolvería 403 (o peor, al revés).
 *
 * Uso:  node scripts/verify-access.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildRotation, canAccess } from '../api/_access.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadCatalog() {
  const src = fs.readFileSync(path.join(ROOT, 'data', 'catalog.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  new vm.Script(src + ';globalThis.__out={CATEGORIES};').runInContext(sandbox);
  return sandbox.__out.CATEGORIES;
}

/** Copia literal de la lógica original de index.html, para contrastar. */
function clientRotation(CATEGORIES, _week) {
  function _weekSet(cats, count, offset) {
    const set = new Set();
    for (let i = 0; i < count; i++) set.add(cats[(_week * 17 + i * 31 + offset) % cats.length]?.id);
    set.delete(undefined);
    return set;
  }
  const _hotCats = CATEGORIES.filter((c) => c.tier === 'hot' && c.ready);
  const _xxxCats = CATEGORIES.filter((c) => c.tier === 'xxx' && c.ready);
  return {
    freeHotIds: _weekSet(_hotCats, 1, 0),
    freeXxxIds: _weekSet(_xxxCats, 1, 7),
    premXxxIds: _weekSet(_xxxCats, 5, 3),
  };
}

function clientCanAccess(cat, currentAccessTier, r) {
  if (currentAccessTier === 'full') return true;
  if (cat.tier === 'casual' || cat.tier === 'editorial') return true;
  if (currentAccessTier === 'premium') {
    if (cat.tier === 'hot') return true;
    if (cat.tier === 'xxx') return r.premXxxIds.has(cat.id);
    return false;
  }
  if (cat.tier === 'hot') return r.freeHotIds.has(cat.id);
  if (cat.tier === 'xxx') return r.freeXxxIds.has(cat.id);
  return false;
}

const eqSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function main() {
  const CATEGORIES = loadCatalog();
  const WEEKS = 200;
  const startWeek = Math.floor((Date.now() + 2 * 864e5) / (7 * 864e5));
  const problems = [];
  let checks = 0;

  for (let w = startWeek; w < startWeek + WEEKS; w++) {
    const server = buildRotation(CATEGORIES, w);
    const client = clientRotation(CATEGORIES, w);

    for (const key of ['freeHotIds', 'freeXxxIds', 'premXxxIds']) {
      if (!eqSet(server[key], client[key])) {
        problems.push(
          `semana ${w}: ${key} difiere — servidor [${[...server[key]]}] vs cliente [${[...client[key]]}]`
        );
      }
    }

    for (const tier of ['free', 'premium', 'full']) {
      for (const cat of CATEGORIES) {
        const s = canAccess(cat, tier, server).ok;
        const c = clientCanAccess(cat, tier, client);
        checks++;
        if (s !== c) {
          problems.push(`semana ${w} tier=${tier} cat=${cat.id} (${cat.tier}): servidor=${s} cliente=${c}`);
        }
      }
    }
  }

  if (problems.length) {
    console.error(`\n✗ ${problems.length} divergencias:\n`);
    for (const p of problems.slice(0, 15)) console.error('  -', p);
    if (problems.length > 15) console.error(`  … y ${problems.length - 15} más`);
    process.exit(1);
  }

  const r = buildRotation(CATEGORIES, startWeek);
  console.log(`\n✓ Servidor y cliente coinciden en ${checks.toLocaleString()} decisiones`);
  console.log(`  (${CATEGORIES.length} categorías × 3 tiers × ${WEEKS} semanas).`);
  console.log(`\nRotación de esta semana (${startWeek}):`);
  console.log(`  hot gratis:      ${[...r.freeHotIds].join(', ') || '—'}`);
  console.log(`  xxx gratis:      ${[...r.freeXxxIds].join(', ') || '—'}`);
  console.log(`  xxx en premium:  ${[...r.premXxxIds].join(', ') || '—'}`);
}

main();
