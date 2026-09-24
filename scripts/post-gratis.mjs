#!/usr/bin/env node
/**
 * Arma el post de muestra: N prompts del catálogo, completos y ya con un
 * nombre puesto, listos para pegar en Patreon o donde sea.
 *
 * Los centinelas se reemplazan acá con la MISMA regla que el navegador
 * (index.html → aParametros y getCharData): un nombre que no está en "mis
 * personajes" cae en los valores por defecto, 'hair' y 'natural features'.
 * Si esto usara otra regla, el prompt del post no sería el que entrega la app.
 *
 *   node scripts/post-gratis.mjs --nombre Elizabeth --salida post-gratis.md
 *   node scripts/post-gratis.mjs --ids a,b,c --nombre Ana --variante prompt2
 *   node scripts/post-gratis.mjs --lista          candidatas con su id
 *
 * Sin --ids toma las primeras 5 casual/editorial publicadas, que son las que
 * se pueden mostrar sin cuenta.
 *
 * El archivo que sale LLEVA PROMPTS: no va a git.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const NOMBRE = arg('--nombre', 'Elizabeth');
const VARIANTE = arg('--variante', 'prompt');
const CUANTOS = Number(arg('--cuantos', 5));
const SOLO_LISTA = process.argv.includes('--lista');

// --salida escribe el archivo desde acá, en UTF-8. Redirigir con > en la
// PowerShell de Windows decodifica la salida con la página de códigos de la
// consola y los acentos llegan rotos al archivo ("rotaci├│n").
const SALIDA = arg('--salida', '');
function entregar(texto) {
  if (!SALIDA) return process.stdout.write(texto);
  // Con BOM: sin él, el Bloc de notas de Windows a veces adivina UTF-16 y
  // muestra el archivo entero en caracteres chinos.
  fs.writeFileSync(path.resolve(SALIDA), '\uFEFF' + texto, 'utf8');
  console.error(`Listo: ${SALIDA}`);
}

const seedPath = path.join(ROOT, 'build', 'prompts.seed.json');
if (!fs.existsSync(seedPath)) {
  console.error('No existe build/prompts.seed.json — corré antes: npm run build:catalog');
  process.exit(1);
}
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const sandbox = {};
vm.createContext(sandbox);
new vm.Script(
  fs.readFileSync(path.join(ROOT, 'data', 'catalog.js'), 'utf8') + ';globalThis.__o={CATEGORIES};'
).runInContext(sandbox);
const cats = sandbox.__o.CATEGORIES;

// Sólo casual y editorial: son las que cualquiera ve sin cuenta, así que
// regalarlas no destapa nada que esté detrás del muro.
const candidatas = cats.filter((c) => ['casual', 'editorial'].includes(c.tier) && c.ready !== false);

if (SOLO_LISTA) {
  for (const c of candidatas) console.log(c.tier.padEnd(10), c.id.padEnd(32), c.name);
  process.exit(0);
}

const pedidos = (arg('--ids', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const elegidas = pedidos.length
  ? pedidos.map((id) => {
      const c = cats.find((x) => x.id === id);
      if (!c) { console.error(`No existe la categoría "${id}".`); process.exit(1); }
      return c;
    })
  : candidatas.slice(0, CUANTOS);

const cuerpos = new Map();
for (const r of seed) cuerpos.set(r.cat_id + '|' + r.variant, r.body);

/** Igual que el navegador: sin ficha de personaje, los valores por defecto. */
function ponerNombre(texto, nombre) {
  return String(texto)
    .replace(/__N[123]?_HAIR__/g, 'hair')
    .replace(/__N[123]?_FEATURES__/g, 'natural features')
    .replace(/__N[123]__/g, nombre)
    .replace(/__N__/g, nombre);
}

/** Los emojis van en el dato pero no en la presentación, igual que cleanName(). */
const limpiar = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}️]/gu, '').trim();

const N = elegidas.length;
let out = `# ${N} prompt${N === 1 ? '' : 's'} gratis, completo${N === 1 ? '' : 's'}, sin rotación\n\n`;
out += N === 1
  ? `Éste es tuyo. No rota, no vence, no hay que registrarse.\n\n`
  : `Estos ${N} son tuyos. No rotan, no vencen, no hay que registrarse.\n\n`;
out += `Cada uno dice **qué hace el cuerpo, dónde van las manos y hacia dónde mira**. `;
out += `Por eso repiten: tirá el mismo prompt cuatro veces y vas a tener cuatro fotos de la misma escena, no cuatro escenas distintas.\n\n`;
out += `**Cómo usarlos:** copiás el bloque y lo pegás en Gemini, ChatGPT, Midjourney o el que uses. `;
out += `Van con el nombre **${NOMBRE}**; cambialo por el que quieras.\n\n---\n\n`;

let n = 0;
for (const c of elegidas) {
  const cuerpo = cuerpos.get(c.id + '|' + VARIANTE);
  if (!cuerpo) {
    console.error(`(!) ${c.id} no tiene la variante ${VARIANTE}, la salteo.`);
    continue;
  }
  n++;
  out += `## ${n} · ${limpiar(c.name)}\n\n`;
  if (c.sub) out += `${limpiar(c.sub)}\n\n`;
  out += '```\n' + ponerNombre(cuerpo, NOMBRE).trim() + '\n```\n\n';
}

out += `---\n\n## Si te sirvieron\n\n`;
out += `Hay ${cats.length - n} escenas más, con la misma regla: la persona por encima del fondo, y la pose escrita de verdad.\n\n`;
out += `Cada escena viene además en dúo y trío, y encima de cualquiera se aplican estilos, prendas, detalles de luz y cámara, y formatos.\n\n`;
out += `**Premium · $7** — todas las escenas Hot, prompts ilimitados\n`;
out += `**Full Access · $10** — todo, más las XXX y el acceso anticipado\n\n`;
out += `Y el plan gratis sigue ahí: 5 prompts nuevos cada semana.\n`;

entregar(out);
