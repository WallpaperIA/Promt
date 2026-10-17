#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// esbuild es dependencia de desarrollo: en una copia nueva falta hasta correr
// npm install. Mejor decirlo que fallar con un error de módulo.
try { await import('esbuild'); } catch {
  console.error('Falta esbuild. Corré `npm install` (o `npm ci`) y probá de nuevo.');
  process.exit(1);
}
const { minificarHtml } = await import('./minificar.mjs');

// Pages publica index.html minificado. Esto comprueba que la versión que se
// publica conserve lo que la página necesita: scripts que compilan, los
// nombres globales que se llaman entre bloques y archivos, y cada id.
const fuente = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const salida = await minificarHtml(fuente);
const bloques = h => [...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const sinCodigo = h => h.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, '');

const scripts = bloques(salida);
assert.equal(scripts.length, bloques(fuente).length, 'Se perdió o se agregó un bloque <script>');
scripts.forEach((codigo, i) => {
  assert.doesNotThrow(() => new vm.Script(codigo, { filename: 'bloque-' + i + '.js' }), 'El bloque ' + i + ' no compila');
});
console.log('OK los ' + scripts.length + ' scripts en línea compilan');

// Los nombres de primer nivel los usan otros bloques, catalog.js,
// modificadores.js y las pruebas de interfaz: tienen que seguir iguales.
const principal = bloques(fuente).sort((a, b) => b.length - a.length)[0];
const globales = new Set();
for (const linea of principal.split('\n')) {
  const m = linea.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
  if (m) globales.add(m[1] || m[2]);
}
assert.ok(globales.size > 100, 'No se encontraron los nombres globales de la página');
const faltan = [...globales].filter(n => !new RegExp('(?<![\\w$])' + n.replace(/\$/g, '\\$') + '(?![\\w$])').test(scripts.join('\n')));
assert.deepEqual(faltan, [], 'Nombres globales renombrados o perdidos');
for (const n of ['canAccessCat', 'rebuildAccordion', 'fusionarCatalogo', 'CATEGORIES', 'STYLES', 'OUTFITS']) {
  assert.ok(salida.includes(n), n + ' no aparece en la versión publicada');
}
console.log('OK se conservan los ' + globales.size + ' nombres de primer nivel');

const ids = h => new Set([...sinCodigo(h).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const idsFuente = ids(fuente), idsSalida = ids(salida);
assert.ok(idsFuente.size > 50);
assert.deepEqual([...idsFuente].filter(id => !idsSalida.has(id)), [], 'Faltan elementos con id');
assert.equal(/<!--/.test(sinCodigo(salida)), false, 'Quedaron comentarios HTML');
// <pre> y <textarea> conservan su contenido exacto.
const literales = h => [...sinCodigo(h).matchAll(/<(pre|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi)].map(m => m[0]);
assert.deepEqual(literales(salida), literales(fuente).map(x => x.replace(/<!--[\s\S]*?-->/g, '')));
// El aviso de mayoría de edad depende del script del <head>: sigue antes del CSS.
assert.ok(salida.indexOf("wp_edad_v1") < salida.indexOf('<style'), 'El script del head quedó después del CSS');
console.log('OK ids, contenidos literales y orden del head intactos');

const kb = s => Math.round(Buffer.byteLength(s) / 1024);
assert.ok(salida.length < fuente.length * 0.8, 'La minificación no achicó la página');
console.log('OK index.html publicado: ' + kb(fuente) + ' KB → ' + kb(salida) + ' KB');
