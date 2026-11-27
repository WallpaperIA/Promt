#!/usr/bin/env node
/**
 * Genera assets/og.png, la imagen que se ve al compartir el link.
 *
 * Las cifras no se escriben a mano: la portada ya se equivocó una vez
 * diciendo 15 prendas cuando eran 26, y una imagen es peor porque no se
 * corrige sola al recargar. Ver cifras() para de dónde sale cada una.
 *
 * Uso:  node scripts/og.mjs
 *
 * La captura sale en ~280 KB. Después conviene pasarla a 256 colores (se ve
 * igual y queda en ~60 KB): WhatsApp a veces no muestra vistas previas de
 * más de ~300 KB. En el 27/11/2026 se hizo con Pillow: quantize(256).
 *
 * Necesita playwright. Si no está instalado, lo dice y no rompe el build:
 * la imagen anterior sigue sirviendo.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Las escenas se cuentan en el catálogo público de la API: data/catalog.js
// ya no tiene las que se crean desde el panel, y la imagen decía 199 con 443
// publicadas. Prendas, peinados, detalles y estilos salen de
// data/modificadores.js, la fuente de esas listas (catalog.js lleva copias).
async function cifras() {
  const m = vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'data', 'modificadores.js'), 'utf8') + ';({STYLES,OUTFITS,HAIRSTYLES,DETAILS})',
    {}, { timeout: 1000 }
  );
  let escenas;
  try {
    const r = await fetch('https://promt-iota.vercel.app/api/catalog', { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    escenas = (await r.json()).categorias.filter((c) => c.status === 'publicada').length;
  } catch (e) {
    console.error('No se pudo leer el catálogo público (' + e.message + '). La imagen anterior sigue en assets/og.png.');
    process.exit(1);
  }
  return {
    escenas,
    // "Original" no es una prenda: es no cambiarla.
    prendas: m.OUTFITS.filter((x) => x.instruction).length,
    // Lo mismo: "Original" es dejar el peinado de la escena.
    peinados: m.HAIRSTYLES.filter((x) => x.instruction).length,
    detalles: m.DETAILS.length,
    estilos: m.STYLES.length,
  };
}
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Falta playwright (npm i -D playwright). La imagen anterior sigue en assets/og.png.');
  process.exit(1);
}

const c = await cifras();
const html = fs
  .readFileSync(path.join(ROOT, 'scripts', 'og.html'), 'utf8')
  .replace('{{escenas}}', c.escenas)
  .replace('{{prendas}}', c.prendas)
  .replace('{{peinados}}', c.peinados)
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
  console.log(`assets/og.png generado — ${c.escenas} escenas · ${c.prendas} prendas · ${c.peinados} peinados · ${c.detalles} detalles · ${c.estilos} estilos`);
} finally {
  fs.unlinkSync(tmp);
}
