#!/usr/bin/env node
/**
 * Genera assets/og.png, la imagen que se ve al compartir el link.
 *
 * Las cifras salen de data/catalog.js, no escritas a mano: la portada ya se
 * equivocó una vez diciendo 15 prendas cuando eran 26, y una imagen es peor
 * porque no se corrige sola al recargar.
 *
 * Uso:  node scripts/og.mjs
 *
 * Necesita playwright. Si no está instalado, lo dice y no rompe el build:
 * la imagen anterior sigue sirviendo.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function cifras() {
  const sandbox = {};
  vm.createContext(sandbox);
  new vm.Script(
    fs.readFileSync(path.join(ROOT, 'data', 'catalog.js'), 'utf8') +
      ';globalThis.__o={CATEGORIES,STYLES,OUTFITS,DETAILS};'
  ).runInContext(sandbox);
  const o = sandbox.__o;
  return {
    escenas: o.CATEGORIES.length,
    // "Original" no es una prenda: es no cambiarla.
    prendas: o.OUTFITS.filter((x) => x.instruction).length,
    detalles: o.DETAILS.length,
    estilos: o.STYLES.length,
  };
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Falta playwright (npm i -D playwright). La imagen anterior sigue en assets/og.png.');
  process.exit(1);
}

const c = cifras();
const html = fs
  .readFileSync(path.join(ROOT, 'scripts', 'og.html'), 'utf8')
  .replace('{{escenas}}', c.escenas)
  .replace('{{prendas}}', c.prendas)
  .replace('{{detalles}}', c.detalles)
  .replace('{{estilos}}', c.estilos);

const tmp = path.join(ROOT, 'scripts', '.og.tmp.html');
fs.writeFileSync(tmp, html);
try {
  const navegador = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
  );
  const pagina = await navegador.newPage({ viewport: { width: 1200, height: 630 } });
  await pagina.goto('file://' + tmp, { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(1200);
  await pagina.screenshot({ path: path.join(ROOT, 'assets', 'og.png') });
  await navegador.close();
  console.log(`assets/og.png generado — ${c.escenas} escenas · ${c.prendas} prendas · ${c.detalles} detalles · ${c.estilos} estilos`);
} finally {
  fs.unlinkSync(tmp);
}
