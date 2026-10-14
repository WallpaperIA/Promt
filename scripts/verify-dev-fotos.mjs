#!/usr/bin/env node
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Se arranca el servidor real en un fixture aislado. El seed queda vacío:
// probar permisos de fotos no necesita descargar ni inventar ningún prompt.
const raiz = mkdtempSync(path.join(tmpdir(), 'wallpaperia-fotos-'));
const escenas = [
  { id: 'foto-publica-sintetica', tier: 'casual', ready: true },
  { id: 'foto-hot-sintetica', tier: 'hot', ready: true },
  { id: 'foto-intima-sintetica', tier: 'xxx', ready: true },
];
let casos = 0;
async function arrancar(tier, admin) {
  const child = spawn(process.execPath, [path.join(raiz, 'scripts/dev-server.mjs'), '--port', '0', '--tier', tier, ...(admin ? ['--admin'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise((resolve, reject) => {
      let salida = '', errores = '';
      const tiempo = setTimeout(() => terminar(new Error('El servidor de prueba no arrancó')), 10000);
      function terminar(error, valor) {
        clearTimeout(tiempo);
        child.stdout.off('data', leer);
        child.off('exit', salir);
        child.off('error', fallar);
        if (error) reject(error); else resolve(valor);
      }
      function leer(datos) {
        salida += datos;
        const encontrado = salida.match(/http:\/\/localhost:(\d+)/);
        if (encontrado) terminar(null, 'http://127.0.0.1:' + encontrado[1]);
      }
      function salir(codigo) { terminar(new Error('El servidor terminó (' + codigo + '): ' + errores)); }
      function fallar(error) { terminar(error); }
      child.stdout.on('data', leer);
      child.stderr.on('data', datos => { errores += datos; });
      child.once('exit', salir);
      child.once('error', fallar);
    });
    return { child, url };
  } catch (error) { child.kill(); throw error; }
}
try {
  for (const carpeta of ['scripts', 'api', 'data', 'build']) mkdirSync(path.join(raiz, carpeta));
  for (const archivo of ['scripts/dev-server.mjs', 'api/_access.js', 'api/_validar.js']) {
    copyFileSync(new URL('../' + archivo, import.meta.url), path.join(raiz, archivo));
  }
  writeFileSync(path.join(raiz, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(raiz, 'data/catalog.js'), 'const CATEGORIES=' + JSON.stringify(escenas) + ';');
  writeFileSync(path.join(raiz, 'build/prompts.seed.json'), '[]');
  for (const [tier, admin, estados] of [
    ['free', false, [200, 403, 403]],
    ['premium', false, [200, 200, 403]],
    ['full', false, [200, 200, 200]],
    ['free', true, [200, 200, 200]],
  ]) {
    const { child, url } = await arrancar(tier, admin);
    try {
      for (let i = 0; i < escenas.length; i++) {
        const respuesta = await fetch(url + '/api/ejemplos?id=' + escenas[i].id, { signal: AbortSignal.timeout(5000) });
        assert.equal(respuesta.status, estados[i], tier + (admin ? ' admin' : '') + ' / ' + escenas[i].tier);
        casos++;
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const terminado = once(child, 'exit');
        child.kill();
        await terminado;
      }
    }
  }
} finally { rmSync(raiz, { recursive: true, force: true }); }
console.log(casos + ' casos: el simulador de fotos respeta Gratis, Premium, Full y administración.');
