#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Esta suite puede correr en un clon público y en GitHub Actions: usa el
// catálogo de metadatos y fixtures sintéticos, nunca prompts ni credenciales.
// No sustituye el round-trip y la salud del catálogo privado de `verify`.
const pruebas = [
  'verify-ejemplos.mjs',
  'verify-versiones.mjs',
  'verify-api-lectura.mjs',
  'verify-access.mjs',
  'verify-patreon.mjs',
  'verify-validar.mjs',
  'verify-admin-session.mjs',
  'verify-fotos-catalogo.mjs',
  'verify-rendimiento-ui.mjs',
  'verify-dev-fotos.mjs',
  'verify-comparador.mjs',
  'verify-modificadores.mjs',
];
const fallos = [];
for (const prueba of pruebas) {
  console.log('\n→ ' + prueba);
  const ruta = fileURLToPath(new URL(prueba, import.meta.url));
  const resultado = spawnSync(process.execPath, [ruta], { stdio: 'inherit' });
  if (resultado.error) console.error(resultado.error.message);
  if (resultado.status !== 0 || resultado.error) fallos.push(prueba);
}
if (fallos.length) {
  console.error('\nFallaron: ' + fallos.join(', '));
  process.exitCode = 1;
} else {
  console.log('\nLas ' + pruebas.length + ' verificaciones públicas pasaron.');
}
