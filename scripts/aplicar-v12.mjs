#!/usr/bin/env node
/**
 * Escribe en data/prompts.js las v1.2 que devolvió el chat generador.
 *
 * Existe porque el camino obvio —pegarlas en el panel— no dura: el panel
 * escribe en Supabase y el próximo `npm run seed` sube todo desde
 * data/prompts.js, pisando lo editado sin avisar. Las 34 volverían a quedar
 * genéricas. La fuente es este archivo, así que el arreglo va acá.
 *
 * Flujo:
 *   1. node scripts/rehacer-v12.mjs --salida pedido-v12.txt
 *      (deja además respuestas-v12.txt, la plantilla donde se pega)
 *   2. Por cada categoría: pedido al chat, respuesta debajo de su
 *      "CATEGORÍA: <id>" en respuestas-v12.txt. No hace falta hacerlas
 *      todas de una vez: las que siguen vacías se saltean.
 *   3. node scripts/aplicar-v12.mjs              revisa, no escribe nada
 *      node scripts/aplicar-v12.mjs --aplicar    escribe (copia antes)
 *   4. npm run build:catalog && npm run verify
 *      node scripts/verify-prompts.mjs --actualizar
 *      npm run seed
 *
 * Opción: --entrada <archivo>  (por defecto respuestas-v12.txt)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'prompts.js');
const APLICAR = process.argv.includes('--aplicar');
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const ENTRADA = path.resolve(arg('--entrada', path.join(ROOT, 'respuestas-v12.txt')));

if (!fs.existsSync(SRC)) {
  console.error('No existe data/prompts.js. Este script corre en la máquina que tiene la fuente.');
  process.exit(1);
}
if (!fs.existsSync(ENTRADA)) {
  console.error(`No existe ${path.basename(ENTRADA)}.`);
  console.error('Se crea con: node scripts/rehacer-v12.mjs --salida pedido-v12.txt');
  process.exit(1);
}

/**
 * La plantilla que deja rehacer-v12.mjs trae una línea "(pegá acá …)" debajo
 * de cada categoría. Se reconoce por el comienzo y no por el texto exacto,
 * para que cambiar la redacción allá no rompa esto.
 */
const MARCA_VACIA = /^\s*\(pegá acá[^)\n]*\)\s*$/gim;

// Las mismas etiquetas que entiende "Pegar del generador" en el panel, para
// que el chat no tenga que aprender dos formatos.
const ETIQUETAS = [
  ['prompt2', /^\s*SOLO\s*V?1\.2\s*:/im],
  ['duoPrompt2', /^\s*D[UÚ]O\s*V?1\.2\s*:/im],
  ['trioPrompt2', /^\s*TR[IÍ]O\s*V?1\.2\s*:/im],
];
const PERSONAS = { prompt2: 1, duoPrompt2: 2, trioPrompt2: 3 };
const MARCADORES = { 1: ['__N__'], 2: ['__N1__', '__N2__'], 3: ['__N1__', '__N2__', '__N3__'] };

// Igual que verify-prompts.mjs: justamente el defecto que se está arreglando.
const RELATIVAS = /\b(?:same (?:scene|pose|setting|outfit|lighting)[^.]{0,40}\bas above|as (?:described |shown )?above|as (?:in|per) the (?:previous|first) (?:prompt|version))\b/i;
const CONOCIDO = /^__N[123]?(?:_HAIR|_FEATURES)?__$/;

function limpiar(t) {
  return t
    .replace(/^\s*```[a-z]*\s*$/gim, '')
    .trim()
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim();
}

/** respuestas-v12.txt → { id: { variante: texto } } */
function leerRespuestas(texto) {
  const bloques = {};
  const re = /^\s*CATEGOR[IÍ]A\s*:\s*([a-z0-9-]+)\s*$/gim;
  const marcas = [...texto.matchAll(re)];
  marcas.forEach((m, i) => {
    const desde = m.index + m[0].length;
    const hasta = i + 1 < marcas.length ? marcas[i + 1].index : texto.length;
    // Fuera la marca de "pegá acá" y las líneas separadoras de la plantilla:
    // sin esto la línea ──── de abajo terminaba adentro del último prompt.
    const cuerpo = texto
      .slice(desde, hasta)
      .replace(MARCA_VACIA, '')
      .replace(/^\s*[─═━-]{5,}\s*$/gm, '')
      .trim();
    if (!cuerpo) return; // todavía sin hacer: se saltea, no es error
    const encontradas = [];
    for (const [v, er] of ETIQUETAS) {
      const e = er.exec(cuerpo);
      if (e) encontradas.push({ v, inicio: e.index, fin: e.index + e[0].length });
    }
    encontradas.sort((a, b) => a.inicio - b.inicio);
    const r = {};
    encontradas.forEach((e, j) => {
      const h = j + 1 < encontradas.length ? encontradas[j + 1].inicio : cuerpo.length;
      r[e.v] = limpiar(cuerpo.slice(e.fin, h));
    });
    bloques[m[1]] = encontradas.length ? r : { __sinEtiquetas: true };
  });
  return bloques;
}

/**
 * Copiar la respuesta seleccionándola en la página del chat pierde los
 * guiones bajos: __N__ se muestra como negrita y lo que llega es "N". Pasó
 * con la primera respuesta, así que se reponen acá en vez de hacer rehacer
 * cada una. Sólo la palabra suelta: una N o N1 aislada no aparece en ningún
 * prompt en inglés por otro motivo. Si hubo que reponer, se avisa.
 */
function reponerMarcadores(texto) {
  let n = 0;
  const t = texto.replace(
    /(^|[^A-Za-z0-9_])(N[123]?(?:_HAIR|_FEATURES)?)(?=$|[^A-Za-z0-9_])/g,
    (_, antes, m) => { n++; return antes + '__' + m + '__'; }
  );
  return { texto: t, repuestos: n };
}

/** Errores que impiden escribir; avisos que no. */
function revisar(variante, texto) {
  const errores = [];
  const avisos = [];
  const n = PERSONAS[variante];
  if (!texto) errores.push('vacío');
  if (RELATIVAS.test(texto)) errores.push('remite a otro texto ("same scene as above")');
  for (const m of MARCADORES[n]) {
    if (!texto.includes(m)) errores.push(`falta ${m}`);
  }
  // En dúo y trío __N__ suelto es un nombre que no se reemplaza nunca.
  if (n > 1 && /__N__/.test(texto)) errores.push('usa __N__ en una variante de varias personas');
  const raros = (texto.match(/__[A-Z0-9_]+__/g) || []).filter((x) => !CONOCIDO.test(x));
  if (raros.length) errores.push(`marcador desconocido: ${[...new Set(raros)].join(', ')}`);
  if (/\$\{|\{nombre\}|\[NOMBRE\]/i.test(texto)) errores.push('nombre con formato equivocado (${…}, {nombre} o [NOMBRE])');
  if (texto.length < 800) avisos.push(`corto: ${texto.length} caracteres`);
  if (texto.length > 2000) avisos.push(`largo: ${texto.length} caracteres`);
  return { errores, avisos };
}

/**
 * Texto con centinelas → cuerpo de plantilla de prompts.js. Misma conversión
 * que aParametros() en index.html, pero con los nombres de parámetro reales de
 * la función que se reemplaza: no se asume que se llamen n, n1, n2.
 */
function aPlantilla(texto, params) {
  const p = (i) => params[i] || params[0];
  return String(texto)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/__N_HAIR__/g, () => '${getCharData(' + p(0) + ').hair}')
    .replace(/__N_FEATURES__/g, () => '${getCharData(' + p(0) + ').features}')
    .replace(/__N([123])_HAIR__/g, (_, i) => '${getCharData(' + p(i - 1) + ').hair}')
    .replace(/__N([123])_FEATURES__/g, (_, i) => '${getCharData(' + p(i - 1) + ').features}')
    .replace(/__N([123])__/g, (_, i) => '${' + p(i - 1) + '}')
    .replace(/__N__/g, () => '${' + p(0) + '}');
}

const respuestas = leerRespuestas(fs.readFileSync(ENTRADA, 'utf8').replace(/^﻿/, ''));
let fuente = fs.readFileSync(SRC, 'utf8');
const original = fuente;

// Los límites de cada categoría: desde su id hasta el id siguiente.
const IDS = [...fuente.matchAll(/\bid\s*:\s*(["'])([^"'\n]+)\1/g)];
const tramo = (id) => {
  const i = IDS.findIndex((m) => m[2] === id);
  if (i === -1) return null;
  return { desde: IDS[i].index, hasta: i + 1 < IDS.length ? IDS[i + 1].index : fuente.length };
};

console.log('\n════ v1.2 DEL CHAT → data/prompts.js ════\n');
const ids = Object.keys(respuestas);
if (!ids.length) {
  console.log('  Ninguna categoría tiene respuesta todavía.\n');
  process.exit(0);
}

let listas = 0;
let conError = 0;
const vistos = new Map();
// De atrás hacia adelante: así reemplazar un tramo no corre los índices de
// los que todavía faltan.
const orden = ids
  .map((id) => ({ id, t: tramo(id) }))
  .sort((a, b) => (b.t ? b.t.desde : -1) - (a.t ? a.t.desde : -1));

const informe = [];
for (const { id, t } of orden) {
  const r = respuestas[id];
  const lineas = [];
  let ok = true;
  if (!t) {
    lineas.push('  ✗ no está en data/prompts.js (¿vive sólo en Supabase?)');
    ok = false;
  } else if (r.__sinEtiquetas) {
    lineas.push('  ✗ sin etiquetas: cada texto tiene que empezar con "SOLO V1.2:", "DÚO V1.2:" o "TRÍO V1.2:"');
    ok = false;
  } else {
    let seg = fuente.slice(t.desde, t.hasta);
    for (const [v, crudo] of Object.entries(r)) {
      const { texto, repuestos } = reponerMarcadores(crudo);
      const { errores, avisos } = revisar(v, texto);
      if (repuestos) avisos.push(`${repuestos} marcadores sin guiones bajos, repuestos`);
      if (vistos.has(texto)) errores.push(`idéntico a ${vistos.get(texto)}`);
      vistos.set(texto, `${id}.${v}`);
      const re = new RegExp('(\\b' + v + '\\s*:\\s*\\()([^)]*)(\\)\\s*=>\\s*)`((?:[^`\\\\]|\\\\.)*)`');
      const m = re.exec(seg);
      if (!m) errores.push(`la categoría no tiene ${v} en data/prompts.js`);
      if (errores.length) {
        lineas.push(`  ✗ ${v}: ${errores.join(' · ')}`);
        ok = false;
        continue;
      }
      const params = m[2].split(',').map((x) => x.trim()).filter(Boolean);
      const nuevo = m[1] + m[2] + m[3] + '`' + aPlantilla(texto, params) + '`';
      seg = seg.slice(0, m.index) + nuevo + seg.slice(m.index + m[0].length);
      lineas.push(`  ✓ ${v}` + (avisos.length ? `  (aviso: ${avisos.join(' · ')})` : ''));
    }
    // Sólo si la categoría entera pasó: a medias quedaría una mezcla de v1.2
    // nuevas y genéricas que después nadie sabe cuál es cuál.
    if (ok) fuente = fuente.slice(0, t.desde) + seg + fuente.slice(t.hasta);
  }
  ok ? listas++ : conError++;
  informe.unshift(`${ok ? '✓' : '✗'} ${id}\n${lineas.join('\n')}`);
}
console.log(informe.join('\n\n'));

console.log(`\n  ${listas} listas · ${conError} con errores`);
if (conError) console.log('  Las que tienen errores no se tocan: corregí la respuesta y volvé a correrlo.');

if (!listas) process.exit(conError ? 1 : 0);
if (!APLICAR) {
  console.log('\n  Nada escrito todavía. Para escribir las listas:');
  console.log('    node scripts/aplicar-v12.mjs --aplicar\n');
  process.exit(0);
}

const copia = SRC + '.antes-de-v12';
fs.writeFileSync(copia, original);
fs.writeFileSync(SRC, fuente);
console.log(`\n  Escritas en data/prompts.js. Copia del anterior: data/${path.basename(copia)}`);
console.log('\n  Ahora:');
console.log('    npm run build:catalog');
console.log('    npm run verify');
console.log('    node scripts/verify-prompts.mjs --actualizar');
console.log('    npm run seed\n');
