#!/usr/bin/env node
/**
 * Arregla defectos concretos de los prompts, sobre data/prompts.js.
 *
 * No reescribe ninguna escena: eso necesita ver la foto de referencia. Sólo
 * corrige cosas que están mal de forma verificable y que el generador de
 * imágenes interpreta peor de lo que parece.
 *
 *   node scripts/mejorar-prompts.mjs              muestra qué cambiaría
 *   node scripts/mejorar-prompts.mjs --aplicar    lo escribe (hace copia antes)
 *
 * Después: npm run build:catalog && npm run verify && npm run seed
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'prompts.js');
const APLICAR = process.argv.includes('--aplicar');

if (!fs.existsSync(SRC)) {
  console.error('No existe data/prompts.js. Este script corre en la máquina que tiene la fuente.');
  process.exit(1);
}

/**
 * Cada arreglo dice qué busca, con qué lo reemplaza y por qué. El porqué se
 * imprime: si alguno no convence, se comenta y listo.
 */
const ARREGLOS = [
  {
    nombre: 'Negative prompt',
    porque:
      'En el chat de Gemini o ChatGPT no hay campo de prompt negativo: es texto\n' +
      '    común. "Negative prompt: plastic skin, CGI" termina NOMBRANDO justo lo\n' +
      '    que se quiere evitar. Dicho como instrucción explícita no hay ambigüedad.',
    buscar: /Negative prompt:\s*/gi,
    poner: 'Avoid completely: ',
  },
  {
    nombre: 'subjects en plural',
    porque:
      'Viene de copiar la coletilla del final sin adaptarla. En una variante de\n' +
      '    una sola persona, pedir "subjects" puede hacer que aparezca más de una.\n' +
      '    Sólo se toca donde la frase es la coletilla, no el texto de la escena.',
    soloUnaPersona: true,
    buscar: /\bsubjects filling (\d+-\d+%) of the frame\b/g,
    poner: 'she fills $1 of the frame',
  },
  {
    nombre: 'Subjects close to camera',
    porque: 'Misma coletilla, otra redacción.',
    soloUnaPersona: true,
    buscar: /\bSubjects close to camera filling the frame\b/g,
    poner: 'She stays close to the camera, filling the frame',
  },
  {
    nombre: 'fragmento colgado ", and décolletage,"',
    porque:
      'Resto de una edición a medias: "fine baby hairs along her hairline\n' +
      '    catching sidelight, and décolletage," no completa ninguna idea.',
    buscar: /catching sidelight, and décolletage,/g,
    poner: 'catching sidelight, natural texture across her shoulders and décolletage,',
  },
  {
    nombre: 'contradicción "Flawless skin"',
    porque:
      'La misma frase pide "Flawless skin" y "preserved natural texture". En un\n' +
      '    prompt, "flawless" es la señal de retoque que todo el resto del catálogo\n' +
      '    trata de evitar. "Even skin tone" conserva la intención —brillo parejo—\n' +
      '    sin pedir piel de muñeca.',
    buscar: /\bFlawless skin with soft natural glow\b/g,
    poner: 'Even skin tone with a soft natural glow',
  },
];

/**
 * El encuadre contradictorio va aparte: no es un reemplazo de texto sino
 * quitar una frase entera, y sólo cuando choca con la escena.
 *
 * La coletilla del recorte cerrado está copiada en cientos de prompts; la
 * frase de cuerpo entero es específica de esa escena. Cuando las dos están,
 * gana la específica y se saca la copiada.
 */
const COLETILLA_RECORTE =
  /\s*Tight editorial crop\s*—\s*subjects filling \d+-\d+% of the frame,[^.]*\.\s*/g;
const DICE_CUERPO_ENTERO = /full body|head to (?:feet|toe)/i;

let texto = fs.readFileSync(SRC, 'utf8');
const original = texto;
const cuentas = Object.fromEntries(ARREGLOS.map((a) => [a.nombre, 0]));
cuentas['encuadre contradictorio'] = 0;

/**
 * Se procesa variante por variante, no sobre el archivo entero.
 *
 * Hace falta saber cuántas personas lleva cada una: en un dúo o un trío
 * "subjects" en plural está BIEN, y un reemplazo a ciegas los rompería. La
 * aridad sale de los parámetros de la función, que es el dato fiable.
 */
const VARIANTE = /(\b(?:prompt2?|duoPrompt2?|trioPrompt2?)\s*:\s*\()([^)]*)(\)\s*=>\s*)`((?:[^`\\]|\\.)*)`/g;

texto = texto.replace(VARIANTE, (entero, antes, params, flecha, cuerpo) => {
  const personas = params.split(',').filter((x) => x.trim()).length;
  let c = cuerpo;

  // El encuadre va PRIMERO: los arreglos de texto de abajo reescriben esa
  // misma coletilla, y después ya no habría nada que reconocer.
  if (DICE_CUERPO_ENTERO.test(c)) {
    const limpio = c.replace(COLETILLA_RECORTE, ' ');
    if (limpio !== c) { cuentas['encuadre contradictorio']++; c = limpio; }
  }

  for (const a of ARREGLOS) {
    if (a.soloUnaPersona && personas !== 1) continue;
    const n = (c.match(a.buscar) || []).length;
    if (!n) continue;
    cuentas[a.nombre] += n;
    c = c.replace(a.buscar, a.poner);
  }
  return antes + params + flecha + '`' + c + '`';
});
const encuadres = cuentas['encuadre contradictorio'];

console.log('\n════ MEJORAS A LOS PROMPTS ════\n');
for (const a of ARREGLOS) {
  console.log(`  ${String(cuentas[a.nombre]).padStart(4)}  ${a.nombre}`);
  console.log(`        ${a.porque.replace(/\n    /g, '\n        ')}\n`);
}
console.log(`  ${String(encuadres).padStart(4)}  encuadre contradictorio`);
console.log('        Pedían cuerpo entero Y recorte cerrado a la vez. La IA elegía una');
console.log('        al azar, así que la misma categoría daba resultados distintos.');
console.log('        Se saca la coletilla copiada y queda la frase propia de la escena.\n');

const total = Object.values(cuentas).reduce((a, b) => a + b, 0);
if (!total) {
  console.log('  Nada que cambiar.\n');
  process.exit(0);
}

if (!APLICAR) {
  console.log(`  ${total} cambios en total. Nada escrito todavía.`);
  console.log('  Para aplicarlos:  node scripts/mejorar-prompts.mjs --aplicar\n');
  process.exit(0);
}

const copia = SRC + '.antes-de-mejorar';
fs.writeFileSync(copia, original);
fs.writeFileSync(SRC, texto);
console.log(`  ${total} cambios aplicados.`);
console.log(`  Copia del archivo anterior: ${path.basename(copia)}`);
console.log('\n  Ahora:  npm run build:catalog && npm run verify && npm run seed\n');
