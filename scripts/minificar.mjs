#!/usr/bin/env node
/**
 * Minifica index.html para publicarlo en Pages. La fuente del repositorio no
 * se toca: se edita a mano, con sus comentarios, y esto sólo corre al armar
 * el artefacto del sitio.
 *
 *   node scripts/minificar.mjs index.html _site/index.html
 *
 * Qué hace, de lo más seguro a lo menos:
 * - CSS de cada <style> y JS de cada <script> en línea, con esbuild. Los
 *   nombres de primer nivel se conservan: catalog.js, modificadores.js y los
 *   bloques entre sí se llaman por esos nombres globales.
 * - Quita los comentarios HTML.
 * - Junta los espacios entre etiquetas en un salto de línea. El navegador ya
 *   los trata como un solo espacio, así que no cambia lo que se ve. No se
 *   toca nada dentro de <pre> ni <textarea>.
 *
 * Los comentarios /*! … *\/ y //! se conservan, como en cualquier minificador.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

// Lo que los navegadores con soporte de la página ya entienden. Evita que
// esbuild reescriba sintaxis moderna (?., ??, clases) a una más larga.
const OBJETIVO = ['chrome100', 'firefox100', 'safari15'];

async function js(codigo) {
  const r = await transform(codigo, { loader: 'js', minify: true, target: OBJETIVO, legalComments: 'inline' });
  return r.code.trimEnd();
}

async function css(codigo) {
  const r = await transform(codigo, { loader: 'css', minify: true, target: OBJETIVO, legalComments: 'inline' });
  return r.code.trimEnd();
}

/** Espacios y comentarios de la parte HTML, fuera de <pre> y <textarea>. */
function html(fragmento) {
  return fragmento
    .split(/(<pre\b[\s\S]*?<\/pre>|<textarea\b[\s\S]*?<\/textarea>)/i)
    .map((parte, i) => (i % 2 ? parte : parte
      .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
      .replace(/\s*\n\s*/g, '\n')))
    .join('');
}

export async function minificarHtml(fuente) {
  const partes = [];
  // Bloques <style> y <script> sin src. Un <script src> se deja tal cual.
  const re = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)|(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi;
  let ultimo = 0;
  for (const m of fuente.matchAll(re)) {
    partes.push(html(fuente.slice(ultimo, m.index)));
    if (m[1]) partes.push(m[1] + await css(m[2]) + m[3]);
    else {
      const tipo = (m[4].match(/\btype=["']?([^"'\s>]+)/i) || [])[1];
      // Sólo JavaScript: un bloque JSON o una plantilla no se reescriben.
      const esJs = !tipo || /^(text|application)\/(java|ecma)script$|^module$/i.test(tipo);
      partes.push(m[4] + (esJs ? await js(m[5]) : m[5]) + m[6]);
    }
    ultimo = m.index + m[0].length;
  }
  partes.push(html(fuente.slice(ultimo)));
  return partes.join('').trim() + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [entrada, salida] = process.argv.slice(2);
  if (!entrada || !salida) {
    console.error('Uso: node scripts/minificar.mjs <entrada.html> <salida.html>');
    process.exit(1);
  }
  const fuente = readFileSync(entrada, 'utf8');
  const resultado = await minificarHtml(fuente);
  writeFileSync(salida, resultado);
  const kb = n => Math.round(Buffer.byteLength(n) / 1024);
  console.log(`${entrada}: ${kb(fuente)} KB → ${salida}: ${kb(resultado)} KB`);
}
