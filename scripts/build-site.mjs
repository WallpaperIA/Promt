#!/usr/bin/env node
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { minificarHtml } from './minificar.mjs';

export const CSP = "default-src 'self'; script-src 'self' https://cloud.umami.is; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://auichymkshiljqdtysqm.supabase.co; connect-src 'self' https://promt-iota.vercel.app https://cloud.umami.is https://api-gateway.umami.dev; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests";
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const archivos = ['terminos.html', 'privacidad.html', 'migrar-ajustes.html', 'assets/favicon.svg',
  'assets/og.png', 'assets/legal.css', 'assets/migrar-ajustes.js', 'data/catalog.js',
  'data/modificadores.js', 'data/prendas-filtros.js', 'data/validar.js'];

export async function construirSitio(destino) {
  const salida = path.resolve(destino);
  // Sólo dos destinos conocidos: un argumento errado no puede borrar el
  // checkout ni convertirlo entero en el sitio público.
  if (![path.join(ROOT, '_site'), path.join(ROOT, 'build/site')].includes(salida)) throw new Error('destino_no_permitido');
  await rm(salida, { recursive: true, force: true });
  await mkdir(path.join(salida, 'assets'), { recursive: true });
  await mkdir(path.join(salida, 'data'), { recursive: true });
  for (const archivo of archivos) await copyFile(path.join(ROOT, archivo), path.join(salida, archivo));
  let html = await minificarHtml(await readFile(path.join(ROOT, 'index.html'), 'utf8'));
  // El HTML publicado no ejecuta JS en línea. La fuente sigue monolítica y
  // la CSP no necesita unsafe-inline ni unsafe-eval para ejecutar scripts.
  const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  for (const bloque of bloques) {
    const nombre = 'assets/app-' + createHash('sha256').update(bloque[1]).digest('hex').slice(0, 16) + '.js';
    await writeFile(path.join(salida, nombre), bloque[1]);
    html = html.replace(bloque[0], `<script src="${nombre}"></script>`);
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="referrer" content="no-referrer">`;
  html = html.replace('<head>', '<head>' + meta);
  await writeFile(path.join(salida, 'index.html'), html);
  for (const archivo of ['terminos.html', 'privacidad.html', 'migrar-ajustes.html']) {
    const original = await readFile(path.join(salida, archivo), 'utf8');
    await writeFile(path.join(salida, archivo), original.replace(/<head>/i, '<head>' + meta));
  }
  return salida;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Sitio público preparado en ' + await construirSitio(process.argv[2] || path.join(ROOT, 'build/site')));
}
