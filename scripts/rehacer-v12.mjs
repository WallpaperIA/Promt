#!/usr/bin/env node
/**
 * Arma el pedido para regenerar las v1.2 que quedaron genéricas.
 *
 * 34 categorías comparten la misma v1.2 palabra por palabra: era la coletilla
 * "same scene and pose as above, but with maximum bare skin revealed", que
 * tenía sentido escrita debajo de la v1 y ninguno guardada aparte. Elegir
 * cualquiera de esas 34 escenas devuelve el mismo prompt sin escena.
 *
 * No se pueden reescribir desde acá: hay que volver a describir la escena, y
 * eso lo sabe el prompt v1 de cada una. Esto arma un archivo con, por cada
 * categoría afectada, su v1 completo y la instrucción de qué devolver.
 *
 *   node scripts/rehacer-v12.mjs --salida pedido-v12.txt
 *   node scripts/rehacer-v12.mjs --lista    sólo los ids
 *
 * El archivo LLEVA PROMPTS: no va a git.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOLO_LISTA = process.argv.includes('--lista');
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

// --salida escribe el archivo desde acá, en UTF-8. Redirigir con > en la
// PowerShell de Windows decodifica la salida con la página de códigos de la
// consola y los acentos llegan rotos al archivo ("rotaci├│n").
const SALIDA = arg('--salida', '');
function entregar(texto) {
  if (!SALIDA) return process.stdout.write(texto);
  fs.writeFileSync(path.resolve(SALIDA), texto, 'utf8');
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
const meta = Object.fromEntries(sandbox.__o.CATEGORIES.map((c) => [c.id, c]));

// Cuerpos exactamente repetidos entre categorías: ésas son las genéricas.
const porCuerpo = new Map();
for (const r of seed) {
  if (!porCuerpo.has(r.body)) porCuerpo.set(r.body, []);
  porCuerpo.get(r.body).push(r);
}
const afectadas = new Map(); // id → Set(variantes)
for (const filas of porCuerpo.values()) {
  if (new Set(filas.map((f) => f.cat_id)).size < 2) continue;
  for (const f of filas) {
    if (!afectadas.has(f.cat_id)) afectadas.set(f.cat_id, new Set());
    afectadas.get(f.cat_id).add(f.variant);
  }
}

const v1 = {};
for (const r of seed) {
  if (['prompt', 'duoPrompt', 'trioPrompt'].includes(r.variant)) {
    (v1[r.cat_id] ||= {})[r.variant] = r.body;
  }
}

const ids = [...afectadas.keys()].sort();
if (SOLO_LISTA) {
  for (const id of ids) console.log(id, '·', [...afectadas.get(id)].sort().join(', '));
  process.exit(0);
}

const BASE = {
  prompt2: 'prompt',
  duoPrompt2: 'duoPrompt',
  trioPrompt2: 'trioPrompt',
};

let out = `PEDIDO PARA REGENERAR LAS v1.2 GENÉRICAS
${ids.length} categorías · generado el ${new Date().toLocaleString('es-AR')}

Estas categorías comparten la misma v1.2 palabra por palabra: un texto sin
escena, sin vestuario y sin lugar. Hay que rehacerlas una por una.

CÓMO USARLO
Pegale al chat generador el bloque de UNA categoría por vez, empezando por la
instrucción de abajo. Lo que devuelva se pega en el panel con "Pegar del
generador", en la categoría correspondiente.

═══════════════════════════════════════════════════════════════
INSTRUCCIÓN (va antes de cada bloque)
═══════════════════════════════════════════════════════════════

Te paso el prompt v1 de una escena. Necesito la versión v1.2: LA MISMA escena,
el MISMO encuadre y la MISMA pose, cambiando sólo cuánta piel se ve y cuánto
detalle de textura se describe.

REGLAS
- Escribí la escena COMPLETA otra vez: lugar, pose, vestuario, luz, fondo y
  cámara. El texto se guarda solo, así que no puede remitir a ningún otro.
- La foto es de ella: al menos dos tercios del texto van a la persona —pose,
  cuerpo, vestuario sobre el cuerpo, pelo, mirada, piel—. El fondo se resuelve
  en una o dos frases y está para que ella resalte, no para competir.
- La pose tiene que ser CONCRETA y nombrar como mínimo qué hace el cuerpo
  (de pie, sentada, de rodillas, recostada, inclinada), dónde están los BRAZOS
  y las MANOS, y hacia dónde miran la cabeza y los ojos. "Relaxed pose",
  "natural posture" o "elegant pose" no dicen nada.
- Si el v1 de referencia trae una pose vaga, concretala acá: sigue siendo la
  misma pose, dicha bien. No inventes otra escena.
- Empezá con el tipo de toma, el sujeto y la pose, todo junto: lo que va
  primero pesa más y la pose no puede quedar enterrada al final.
- El encuadre se dice UNA vez y no se contradice: o cuerpo entero, o plano
  cerrado. Pedir los dos hace que el generador elija al azar.
- Nunca escribas "same scene as above", "as described above" ni nada que
  apunte a otro texto. Es el error que estamos corrigiendo.
- Usá los marcadores exactos: __N__ para una persona; __N1__, __N2__, __N3__
  para dúo y trío. Dos guiones bajos a cada lado, en mayúscula. Nunca un
  nombre propio, nunca \${n}, nunca [NOMBRE].
- En inglés, entre 900 y 1800 caracteres.
- Piel real: poros visibles, textura natural, sin retoque. Nada de
  "flawless skin".
- Devolvé sólo el texto del prompt, sin comillas ni explicaciones.

═══════════════════════════════════════════════════════════════

`;

for (const id of ids) {
  const m = meta[id] || {};
  const variantes = [...afectadas.get(id)].sort();
  out += `\n${'─'.repeat(63)}\n`;
  out += `CATEGORÍA: ${id}\n`;
  out += `Nombre: ${m.name || '(sin nombre)'}\n`;
  out += `Subtítulo: ${m.sub || '(sin subtítulo)'}\n`;
  out += `Tier: ${m.tier || '?'}\n`;
  out += `Variantes a rehacer: ${variantes.join(', ')}\n`;
  out += `${'─'.repeat(63)}\n`;
  for (const v of variantes) {
    const origen = BASE[v];
    const texto = v1[id] && v1[id][origen];
    out += `\n### ${v}  — basada en ${origen}\n`;
    out += texto
      ? `\nPROMPT v1 DE REFERENCIA:\n${texto}\n`
      : `\n(!) No hay ${origen} para esta categoría: describila desde el nombre y el subtítulo.\n`;
  }
  out += '\n';
}

out += `\n${'═'.repeat(63)}\nDESPUÉS DE PEGAR TODAS\n`;
out += `  npm run build:catalog\n  npm run verify\n`;
out += `Si quedaron arregladas, asentarlo:\n  node scripts/verify-prompts.mjs --actualizar\n`;

entregar(out);
