#!/usr/bin/env node
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { minificarHtml } from './minificar.mjs';

// Qué permite cada dominio y por qué:
// - promt-iota.vercel.app: la API (desde GitHub Pages es otro origen).
// - cloud.umami.is (sólo script-src): el script de métricas. Los eventos van
//   a gateway.umami.is/api/send: sin ese host, Umami cargaba pero no contaba
//   nada. No se conecta a ningún otro dominio de Umami.
// - auichymkshiljqdtysqm.supabase.co: las fotos firmadas (img) y Panel →
//   Miniaturas, que las baja con fetch() para achicarlas en un canvas.
// - Google Fonts: hoja de estilos y archivos de la fuente.
const SUPABASE = 'https://auichymkshiljqdtysqm.supabase.co';
export const CSP = "default-src 'self'; script-src 'self' https://cloud.umami.is; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: " + SUPABASE + "; connect-src 'self' https://promt-iota.vercel.app https://gateway.umami.is " + SUPABASE + "; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests";

/** La CSP con los hashes de los scripts que quedan en línea. */
export function cspConHashes(hashes) {
  if (!hashes.length) return CSP;
  return CSP.replace("script-src 'self'", "script-src 'self' " + hashes.map(h => `'sha256-${h}'`).join(' '));
}
// Un script del <head> se queda en línea si es así de chico: el del aviso de
// mayoría de edad (~110 bytes) decide antes de pintar si se muestra. Como
// <script src> síncrono sumaba un viaje bloqueante antes del primer
// pintado; en línea con su hash en la CSP no necesita 'unsafe-inline'.
const MAX_EN_LINEA = 1024;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const archivos = ['terminos.html', 'privacidad.html', 'migrar-ajustes.html', 'assets/favicon.svg',
  'assets/og.png', 'assets/legal.css', 'assets/migrar-ajustes.js', 'assets/ajustes-cuenta.js', 'assets/ajustes-datos.js',
  'assets/creacion.js', 'assets/creacion-datos.js', 'assets/creacion.css', 'assets/visual.css', 'data/catalog.js',
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
  const finHead = html.indexOf('</head>');
  const hashes = [];
  for (const bloque of bloques) {
    if (bloque.index < finHead && Buffer.byteLength(bloque[1]) <= MAX_EN_LINEA) {
      hashes.push(createHash('sha256').update(bloque[1], 'utf8').digest('base64'));
      continue;
    }
    const nombre = 'assets/app-' + createHash('sha256').update(bloque[1]).digest('hex').slice(0, 16) + '.js';
    await writeFile(path.join(salida, nombre), bloque[1]);
    html = html.replace(bloque[0], `<script src="${nombre}"></script>`);
  }
  const meta = csp => `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">`;
  // Chromium apaga el "preload scanner" en las páginas con CSP en <meta>
  // (la única forma de ponerla en GitHub Pages). Sin él, los scripts del
  // final del <body> se pedían de a uno, cada uno al terminar el anterior:
  // el catálogo quedaba usable ~0,7 s más tarde en un celular. Un <link
  // rel=preload> en el <head> lo procesa el parser apenas llega, así que
  // los cuatro viajan en paralelo; el orden de ejecución no cambia.
  const cuerpo = html.slice(html.indexOf('</head>'));
  const precargas = [...cuerpo.matchAll(/<script src="([^"]+)"><\/script>/g)]
    .map(m => `<link rel="preload" as="script" href="${m[1]}">`).join('');
  html = html.replace('<head>', '<head>' + meta(cspConHashes(hashes)) + precargas);
  await writeFile(path.join(salida, 'index.html'), html);
  for (const archivo of ['terminos.html', 'privacidad.html', 'migrar-ajustes.html']) {
    const original = await readFile(path.join(salida, archivo), 'utf8');
    await writeFile(path.join(salida, archivo), original.replace(/<head>/i, '<head>' + meta(CSP)));
  }
  return salida;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Sitio público preparado en ' + await construirSitio(process.argv[2] || path.join(ROOT, 'build/site')));
}
