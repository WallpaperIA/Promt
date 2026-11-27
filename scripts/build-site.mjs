#!/usr/bin/env node
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { minificarHtml } from './minificar.mjs';

// Qué permite cada dominio y por qué:
// - promt-iota.vercel.app: la API (desde GitHub Pages es otro origen).
// - cloud.umami.is (sólo script-src): el script de métricas. Los eventos van
//   a gateway.umami.is/api/send: sin ese host, Umami cargaba pero no contaba
//   nada. No se conecta a ningún otro dominio de Umami.
// - auichymkshiljqdtysqm.supabase.co: las fotos firmadas (img) y la
//   revisión automática del panel, que las baja con fetch() para achicarlas
//   en un canvas.
// Sin Google Fonts desde el 27/11/2026: el diseño usa la fuente del sistema
// y la hoja externa frenaba el primer dibujado.
const SUPABASE = 'https://auichymkshiljqdtysqm.supabase.co';
export const CSP = "default-src 'self'; script-src 'self' https://cloud.umami.is; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: " + SUPABASE + "; connect-src 'self' https://promt-iota.vercel.app https://gateway.umami.is " + SUPABASE + "; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests";

/** La CSP con los hashes de los scripts que quedan en línea. */
export function cspConHashes(hashes) {
  if (!hashes.length) return CSP;
  return CSP.replace("script-src 'self'", "script-src 'self' " + hashes.map(h => `'sha256-${h}'`).join(' '));
}
// Un script del <head> se queda en línea si es así de chico: el del aviso de
// mayoría de edad decide antes de pintar si se muestra, y desde el 27/11/2026
// también si se tapa la página mientras llegan los ajustes de la cuenta y
// precarga el catálogo y el lote de fotos (~1,2 KB minificado). Como
// <script src> síncrono sumaba un viaje bloqueante antes del primer
// pintado; en línea con su hash en la CSP no necesita 'unsafe-inline'.
const MAX_EN_LINEA = 1536;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const archivos = ['terminos.html', 'privacidad.html', 'migrar-ajustes.html', 'assets/favicon.svg',
  'assets/og.png', 'assets/legal.css', 'assets/migrar-ajustes.js', 'assets/ajustes-cuenta.js', 'assets/ajustes-datos.js',
  'assets/creacion.js', 'assets/creacion-datos.js', 'assets/creacion.css', 'assets/fisico.js', 'assets/fisico-ui.js', 'assets/fisico.css', 'assets/texto-escena.js', 'assets/personajes-en-uso.js', 'assets/visual.css', 'data/catalog.js',
  'data/modificadores.js', 'data/prendas-filtros.js', 'data/validar.js'];

/**
 * Agrega `?h=<hash del contenido>` a cada script y hoja de estilos local
 * que el HTML publicado pide por etiqueta. Vercel sirve esas URLs con caché
 * de un año (vercel.json): sin esto revalidaba ~14 archivos en cada visita,
 * y los estilos del <head> esperaban esa ida y vuelta antes de pintar.
 * Cambiar un archivo cambia su URL, así que nunca queda una copia vieja.
 * Los `?v=` escritos a mano en la fuente se reemplazan; lo que el código
 * pide por su cuenta (módulos, validar.js) no lleva `?h=` y se sigue
 * revalidando, porque ahí un olvido de versión dejaría algo viejo un año.
 */
async function versionarRecursos(html, salida) {
  const rutas = new Set([...html.matchAll(/(?:src|href)="((?:assets|data)\/[A-Za-z0-9_./-]+\.(?:js|css))(?:\?[^"]*)?"/g)].map(m => m[1]));
  for (const ruta of rutas) {
    if (ruta.startsWith('assets/app-') || ruta.includes('..')) continue; // ya llevan el hash en el nombre
    let contenido;
    try { contenido = await readFile(path.join(salida, ruta)); } catch { continue; }
    const h = createHash('sha256').update(contenido).digest('hex').slice(0, 12);
    const literal = ruta.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    html = html.replace(new RegExp('((?:src|href)=")' + literal + '(?:\\?[^"]*)?"', 'g'), `$1${ruta}?h=${h}"`);
  }
  return html;
}

export async function construirSitio(destino) {
  const salida = path.resolve(destino);
  // Sólo dos destinos conocidos: un argumento errado no puede borrar el
  // checkout ni convertirlo entero en el sitio público.
  if (![path.join(ROOT, '_site'), path.join(ROOT, 'build/site')].includes(salida)) throw new Error('destino_no_permitido');
  await rm(salida, { recursive: true, force: true });
  await mkdir(path.join(salida, 'assets'), { recursive: true });
  await mkdir(path.join(salida, 'data'), { recursive: true });
  const modificadores = await readFile(path.join(ROOT, 'data/modificadores.js'), 'utf8');
  const prendas = vm.runInNewContext(modificadores + '\nOUTFITS', {}, { timeout: 1000 });
  const fotos = prendas.filter(prenda => prenda.foto).map(({ id }) => {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('ID de prenda inválido: ' + id);
    return 'assets/prendas/' + id + '.webp';
  });
  await mkdir(path.join(salida, 'assets/prendas'), { recursive: true });
  for (const archivo of [...archivos, ...fotos]) await copyFile(path.join(ROOT, archivo), path.join(salida, archivo));
  let html = await minificarHtml(await readFile(path.join(ROOT, 'index.html'), 'utf8'));
  // El script del <head> precarga /api/catalog?desde=<sello>: el sello tiene
  // que ser el CATALOG_BUILT_AT del catalog.js que se publica junto a este
  // HTML, o la precarga no coincide con el pedido de la página. Va antes de
  // calcular el hash del script para la CSP.
  const sello = (await readFile(path.join(salida, 'data/catalog.js'), 'utf8')).match(/CATALOG_BUILT_AT\s*=\s*"([^"]+)"/)?.[1];
  // Sólo una fecha ISO: así entra tal cual dentro del string del script.
  if (!/^[0-9TZ:.+-]+$/.test(sello || '')) throw new Error('data/catalog.js sin un CATALOG_BUILT_AT válido');
  if (html.split('__SELLO_CATALOGO__').length !== 2) throw new Error('index.html tiene que tener una sola marca de la precarga del catálogo');
  html = html.replace('__SELLO_CATALOGO__', sello);
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
  // Antes de armar las precargas: precarga y etiqueta tienen que pedir la
  // misma URL o el navegador baja el archivo dos veces.
  html = await versionarRecursos(html, salida);
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
    const original = await versionarRecursos(await readFile(path.join(salida, archivo), 'utf8'), salida);
    await writeFile(path.join(salida, archivo), original.replace(/<head>/i, '<head>' + meta(CSP)));
  }
  return salida;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Sitio público preparado en ' + await construirSitio(process.argv[2] || path.join(ROOT, 'build/site')));
}
