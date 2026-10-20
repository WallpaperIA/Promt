#!/usr/bin/env node
// Abre el sitio publicado (build/site) en Chromium, bajo su CSP real, en los
// dos orígenes (GitHub Pages y la cuenta en Vercel) y en celular y
// escritorio. Falla ante cualquier `securitypolicyviolation` o error de JS.
//
// No usa la red: la API, Umami, Supabase y las fuentes se simulan, así que
// mide lo que la CSP permite, no si esos servicios responden. Sin Playwright
// o sin Chromium (como en el CI) se omite y lo dice.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construirSitio } from './build-site.mjs';

const require = createRequire(import.meta.url);
let chromium;
for (const donde of ['playwright', '/opt/node-tools/node_modules/playwright']) {
  try { ({ chromium } = require(donde)); break; } catch {}
}
const ejecutable = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
if (!chromium) { console.log('Omitido: no hay Playwright en esta máquina.'); process.exit(0); }

const sitio = await construirSitio(fileURLToPath(new URL('../build/site', import.meta.url)));
const PAGES = 'https://wallpaperia.github.io/Promt/', CUENTA = 'https://promt-iota.vercel.app/';
const SUPABASE = 'https://auichymkshiljqdtysqm.supabase.co';
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
// Hace lo mismo que el script de Umami: manda el evento a su gateway.
const UMAMI = "window.umami={track(){fetch('https://gateway.umami.is/api/send',{method:'POST',body:'{}',keepalive:true}).catch(()=>{})}};window.umami.track();";
const PROMPT = 'Editorial photo of __N__ with __N_HAIR__, standing by a window, hands on the sill.\n16:9 4K ultra-sharp resolution.';

let navegador;
try {
  navegador = await chromium.launch(ejecutable ? { executablePath: ejecutable } : {});
} catch (e) {
  console.log('Omitido: no se pudo abrir Chromium (' + String(e.message).split('\n')[0] + ').');
  process.exit(0);
}
const catalogo = await readFile(path.join(sitio, 'data/catalog.js'), 'utf8');
const primeraId = catalogo.match(/"id":"([a-z0-9][a-z0-9_-]*)"/)[1];

async function recorrer(base, vista) {
  const origen = new URL(base).origin;
  const contexto = await navegador.newContext({ viewport: vista, serviceWorkers: 'block' });
  await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: origen });
  const enviados = { umami: 0, supabase: 0 };
  await contexto.route('**/*', async ruta => {
    const url = new URL(ruta.request().url());
    const cors = { 'access-control-allow-origin': origen, vary: 'Origin' };
    if (url.href.startsWith(base) && !url.pathname.startsWith('/api/')) {
      const relativo = decodeURIComponent(url.pathname.slice(new URL(base).pathname.length)) || 'index.html';
      const archivo = path.join(sitio, relativo);
      if (!archivo.startsWith(sitio) || !existsSync(archivo)) return ruta.fulfill({ status: 404, body: '' });
      return ruta.fulfill({ status: 200, body: await readFile(archivo), contentType: TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    }
    if (url.origin === new URL(CUENTA).origin && url.pathname.startsWith('/api/')) {
      const json = (status, cuerpo) => ruta.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(cuerpo) });
      if (url.pathname === '/api/auth/verify') return json(401, { error: 'Invalid session' });
      if (url.pathname === '/api/catalog') return json(200, { gratis: [primeraId], conEjemplos: [primeraId], categorias: [], eliminadas: [] });
      if (url.pathname === '/api/prompt') return json(200, { prompts: { prompt: PROMPT, duoPrompt: PROMPT.replace('__N__', '__N1__ and __N2__'), trioPrompt: PROMPT } });
      if (url.pathname === '/api/ejemplos') return json(200, { imagenes: [SUPABASE + '/storage/v1/object/sign/ejemplos/a.jpg?token=x'], miniaturas: [SUPABASE + '/storage/v1/object/sign/ejemplos/a.jpg.mini.webp?token=x'] });
      return json(404, { error: 'not_found' });
    }
    if (url.origin === 'https://cloud.umami.is') return ruta.fulfill({ status: 200, contentType: 'text/javascript', body: UMAMI });
    if (url.origin === 'https://gateway.umami.is') { enviados.umami++; return ruta.fulfill({ status: 200, headers: cors, body: '{}' }); }
    if (url.origin === SUPABASE) { enviados.supabase++; return ruta.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'image/png', body: PNG }); }
    if (url.origin === 'https://fonts.googleapis.com') return ruta.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return ruta.abort();
  });
  const pagina = await contexto.newPage();
  await pagina.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' → ' + e.blockedURI));
  });
  const errores = [];
  pagina.on('pageerror', e => errores.push('pageerror: ' + e.message));
  pagina.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) errores.push('console: ' + m.text()); });

  await pagina.goto(base, { waitUntil: 'domcontentloaded' });
  await pagina.click('#edad-si');
  // Explorar: abrir la escena gratis desde su tarjeta, escribir un nombre y copiar.
  const tarjeta = pagina.locator('.catalogo-abrir').first();
  await tarjeta.waitFor({ state: 'visible', timeout: 15000 });
  await tarjeta.click();
  const nombre = pagina.locator('.free-name-input:visible').first();
  await nombre.waitFor({ state: 'visible', timeout: 15000 });
  await nombre.fill("Ána O'Hara $1");
  await pagina.locator('.free-name-copy-btn:visible').first().click();
  await pagina.waitForFunction(() => navigator.clipboard.readText().then(t => t.includes("Ána O'Hara $1")), null, { timeout: 5000 });
  // Planes, Ajustes, Lista y búsqueda.
  await pagina.locator('[data-abrir-planes]:visible').first().click();
  await pagina.keyboard.press('Escape');
  await pagina.click('#settings-btn');
  await pagina.keyboard.press('Escape');
  const lista = pagina.locator('.catalogo-vistas button', { hasText: 'Lista' });
  if (await lista.count()) await lista.first().click();
  await pagina.fill('#search', 'retrato');
  // Lo que hace Panel → Miniaturas (fetch de la foto firmada) y una foto.
  const directo = await pagina.evaluate(async url => {
    try {
      const r = await fetch(url); const b = await r.blob();
      await new Promise((ok, mal) => { const i = new Image(); i.onload = ok; i.onerror = mal; i.src = url + '&img=1'; });
      return b.size > 0 ? 'ok' : 'vacía';
    } catch (e) { return 'falló: ' + (e.message || e.type || e); }
  }, SUPABASE + '/storage/v1/object/sign/ejemplos/a.jpg?token=y');
  await pagina.waitForTimeout(300);
  const violaciones = await pagina.evaluate(() => window.__csp);
  await contexto.close();
  return { violaciones, errores, enviados, directo };
}

const casos = [];
try {
  for (const base of [PAGES, CUENTA]) {
    for (const [nombre, vista] of [['celular', { width: 390, height: 844 }], ['escritorio', { width: 1366, height: 900 }]]) {
      const r = await recorrer(base, vista);
      const etiqueta = new URL(base).hostname + ' / ' + nombre;
      assert.deepEqual(r.violaciones, [], etiqueta + ': violaciones de CSP');
      assert.deepEqual(r.errores, [], etiqueta + ': errores');
      assert.equal(r.directo, 'ok', etiqueta + ': bajar una foto firmada como Panel → Miniaturas');
      assert.ok(r.enviados.umami > 0, etiqueta + ': el evento de Umami no salió');
      assert.ok(r.enviados.supabase > 0, etiqueta + ': no se pidió ninguna foto de Storage');
      casos.push(etiqueta);
    }
  }
} finally {
  await navegador.close();
}
console.log('OK sin violaciones de CSP ni errores: ' + casos.join(', '));
