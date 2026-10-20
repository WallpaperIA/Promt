#!/usr/bin/env node
// Corre las pruebas que arman el sitio desde una copia del repositorio en una
// carpeta con espacio y tilde. `new URL(...).pathname` deja "%20" y "%C3%B1"
// (y en Windows una barra antes de "C:"): construirSitio() no reconocía su
// propio destino y fallaba con destino_no_permitido. El dueño trabaja en
// Windows, donde esas carpetas son comunes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../', import.meta.url));
// Sólo lo versionado: nunca se copia data/prompts.js ni otro archivo privado.
const listado = spawnSync('git', ['ls-files', '-z'], { cwd: raiz, encoding: 'utf8' });
if (listado.status !== 0) {
  console.log('Omitido: hace falta git para listar los archivos versionados.');
  process.exit(0);
}
const base = mkdtempSync(path.join(tmpdir(), 'wallpaperia '));
const copia = path.join(base, 'carpeta con ñ y espacios', 'Promt');
try {
  for (const archivo of listado.stdout.split('\0').filter(Boolean)) {
    const destino = path.join(copia, archivo);
    mkdirSync(path.dirname(destino), { recursive: true });
    cpSync(path.join(raiz, archivo), destino);
  }
  assert.ok(!existsSync(path.join(copia, 'data', 'prompts.js')));
  // esbuild hace falta para minificar. 'junction' no pide permisos en Windows.
  symlinkSync(path.join(raiz, 'node_modules'), path.join(copia, 'node_modules'), 'junction');
  for (const prueba of ['verify-build-site.mjs', 'verify-modificadores.mjs', 'verify-prendas-favoritas.mjs']) {
    const r = spawnSync(process.execPath, [path.join(copia, 'scripts', prueba)], { cwd: copia, encoding: 'utf8' });
    assert.equal(r.status, 0, prueba + ' falló en una ruta con espacios y tildes:\n' + (r.stderr || r.stdout).slice(-800));
  }
  console.log('OK el sitio se arma y verifica desde una carpeta con espacios y tildes');
} finally {
  rmSync(base, { recursive: true, force: true });
}
