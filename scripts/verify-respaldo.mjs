#!/usr/bin/env node
/**
 * El respaldo del panel tiene que volver idéntico.
 *
 * El botón "Respaldo" baja las categorías que viven sólo en Supabase con el
 * formato de data/prompts.js. Si ese texto no se puede pegar y reconstruir tal
 * cual, el respaldo no sirve para nada — y peor, parecería servir.
 *
 * Se prueba el ciclo entero: cuerpo guardado → entrada de prompts.js →
 * ejecutar esa función → comparar byte a byte. Con los 1188 reales y con
 * textos hostiles a propósito: un acento grave cierra la plantilla y un
 * ${...} interpola, así que cualquiera de los dos rompería el archivo.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Las funciones se leen del index.html, no se copian: duplicarlas haría que
// esta verificación siguiera dando bien mientras la app ya está rota.
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const desde = html.indexOf('  function aLiteral(texto){');
const hasta = html.indexOf('  async function descargarRespaldo');
if (desde < 0 || hasta < 0) {
  console.error('✗ No se encontró el generador de respaldo en index.html');
  process.exit(1);
}
const ctx = { JSON };
vm.createContext(ctx);
new vm.Script(html.slice(desde, hasta) + ';globalThis.__f={comoEntrada};').runInContext(ctx);
const { comoEntrada } = ctx.__f;

/** Mismo stub que usa scripts/build-catalog.mjs. */
function getCharData(n) {
  const m = String(n).match(/^__(N[123]?)__$/);
  const tag = m ? m[1] : 'N';
  return { hair: `__${tag}_HAIR__`, features: `__${tag}_FEATURES__` };
}
const ARGS = { 1: ['__N__'], 2: ['__N1__', '__N2__'], 3: ['__N1__', '__N2__', '__N3__'] };
const ARIDAD = { prompt: 1, prompt2: 1, duoPrompt: 2, duoPrompt2: 2, trioPrompt: 3, trioPrompt2: 3 };

const seedPath = path.join(ROOT, 'build', 'prompts.seed.json');
if (!fs.existsSync(seedPath)) {
  console.error('No existe build/prompts.seed.json — corré antes: npm run build:catalog');
  process.exit(1);
}
const porCat = {};
for (const r of JSON.parse(fs.readFileSync(seedPath, 'utf8'))) {
  (porCat[r.cat_id] ||= {})[r.variant] = r.body;
}

const casos = Object.entries(porCat).map(([id, prompts]) => ({
  id, tier: 'casual', name: 'x', sub: 'y', prompts,
}));
casos.push({
  id: 'hostil',
  tier: 'hot',
  name: 'Comillas "y" \'esto\'',
  sub: 'con ` acento grave',
  prompts: {
    prompt: 'Portrait of __N__ with a ` backtick, a ${interpolation}, a \\ backslash and __N_HAIR__ hair.',
    duoPrompt: '__N1__ and __N2__ — `nested ${x}` and __N1_FEATURES__.',
    trioPrompt: '__N1__, __N2__, __N3__ · $1 · ${} · `` ',
  },
});

let ok = 0;
const fallos = [];
for (const cat of casos) {
  const sandbox = { getCharData };
  vm.createContext(sandbox);
  try {
    new vm.Script('globalThis.__c = [' + comoEntrada(cat) + '][0];').runInContext(sandbox);
  } catch (e) {
    fallos.push(`${cat.id}: la entrada generada no compila — ${e.message}`);
    continue;
  }
  const rec = sandbox.__c;
  if (rec.id !== cat.id || rec.name !== cat.name || rec.sub !== cat.sub || rec.tier !== cat.tier) {
    fallos.push(`${cat.id}: la metadata no vuelve igual`);
  }
  for (const [v, body] of Object.entries(cat.prompts)) {
    const salida = rec[v](...ARGS[ARIDAD[v]]);
    if (salida === body) ok++;
    else fallos.push(`${cat.id}.${v}: el cuerpo no vuelve igual`);
  }
}

console.log('\n════ RESPALDO DEL PANEL ════');
console.log(`  ✓ ${casos.length} categorías pasadas a formato prompts.js y reconstruidas`);
console.log(`  ✓ ${ok} prompts idénticos byte a byte`);
console.log('  ✓ acentos graves, ${...} y barras invertidas no rompen el archivo');
if (fallos.length) {
  console.error(`\n✗ ${fallos.length} fallos:`);
  fallos.slice(0, 10).forEach((f) => console.error('  -', f));
  process.exit(1);
}
