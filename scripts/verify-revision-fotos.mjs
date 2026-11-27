#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// La revisión automática de fotos del panel (index.html), con la API, las
// fotos y el reloj sintéticos: qué baja, qué sube, cuándo corre y cuándo no.
// La codificación real (versionLiviana, hacerMiniatura) es la misma de la
// subida y se reemplaza acá por resultados conocidos.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const inicio = html.indexOf('  const KEY_REVISION_FOTOS');
const fin = html.indexOf('\n  }\n', html.indexOf('function programarRevisionFotos(){')) + 4;
assert.ok(inicio > 0 && fin > inicio, 'No se encontró la revisión automática en index.html');
const bloque = html.slice(inicio, fin);
const tipos = html.match(/const TIPO_POR_EXTENSION = [^\n]+\n/)[0];
const peso = html.match(/const pesoLegible = [^\n]+\n/)[0];

const KB = 1024;
function crear({ pointer = 'fine', saveData = false, webp = true, locks, fotos, falla = {}, livianas = {}, guardado, ahora = 1e12 } = {}) {
  const pedidos = [], bajadas = [], toasts = [], eventos = [], timers = [];
  const almacen = new Map(guardado ? [['wp_fotos_revisadas_v1', JSON.stringify(guardado)]] : []);
  const reloj = { ahora };
  const blob = (size) => ({ size });
  const contexto = vm.createContext({
    matchMedia: (q) => ({ matches: q === '(pointer: fine)' ? pointer === 'fine' : false }),
    navigator: { connection: { saveData }, ...(locks ? { locks } : {}) },
    localStorage: { getItem: (k) => almacen.has(k) ? almacen.get(k) : null, setItem: (k, v) => almacen.set(k, String(v)) },
    Date: class extends Date { static now() { return reloj.ahora; } },
    JSON, Object, Array, Set, String, Promise,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    window: {},
    document: { dispatchEvent: (e) => eventos.push(e.type) },
    CustomEvent: class { constructor(type) { this.type = type; } },
    showToast: (texto, tipo) => toasts.push([texto, tipo]),
    codificaWebp: () => webp,
    api: async (url, opciones) => {
      pedidos.push([url, opciones ? JSON.parse(opciones.body) : null]);
      if (url === '/api/admin/ejemplos?todas=1') {
        if (falla.listado) throw new Error('fallo sintético');
        return { total: fotos.length, fotos };
      }
      if (falla.subida) throw new Error('fallo sintético');
      return { ok: true };
    },
    bajarOriginal: async (im) => {
      bajadas.push(im.ruta);
      if (falla.bajar === im.ruta) throw new Error('foto_400');
      return blob(im.bytes);
    },
    // Una liviana conocida por ruta; null = ya estaba bien.
    versionLiviana: async (original, tipo) => livianas[original.size] ?? null,
    hacerMiniatura: async () => webp ? 'data:image/webp;base64,UklGRg==' : null,
    leerComoDataUrl: async (b) => 'data:x;base64,' + b.size,
  });
  vm.runInContext(tipos + peso + bloque + '\nthis.revisarFotos = revisarFotos; this.programarRevisionFotos = programarRevisionFotos;', contexto);
  const subidas = () => pedidos.filter(([, cuerpo]) => cuerpo).map(([, c]) => [c.ruta, c.accion || 'miniatura']);
  const estado = () => JSON.parse(almacen.get('wp_fotos_revisadas_v1') || 'null');
  return { contexto, pedidos, bajadas, toasts, eventos, timers, reloj, subidas, estado, almacen };
}

// Como las manda el servidor: pesada = más de 400 KB.
const fotos = [
  { id: 'a', ruta: 'a/grande.jpg', bytes: 1300 * KB, mini: true, pesada: true, url: 'u1' },
  { id: 'a', ruta: 'a/sin-mini.jpg', bytes: 90 * KB, mini: false, pesada: false, url: 'u2' },
  { id: 'b', ruta: 'b/bien.jpg', bytes: 450 * KB, mini: true, pesada: true, url: 'u3' },
  { id: 'b', ruta: 'b/grande.webp', bytes: 900 * KB, mini: true, pesada: true, url: 'u4' },
  { id: 'c', ruta: 'c/rara.gif', bytes: 800 * KB, mini: true, pesada: true, url: 'u5' },
];
// Lo que devuelve versionLiviana según el peso de la original.
const livianas = { [1300 * KB]: { size: 320 * KB }, [900 * KB]: { size: 200 * KB } };

let casos = 0;
const problemas = [];
async function probar(nombre, fn) {
  try { await fn(); casos++; }
  catch (e) { problemas.push({ nombre, mensaje: e.stack }); }
}

await probar('achica las pesadas, genera las miniaturas que faltan y avisa una vez', async () => {
  const r = crear({ fotos, livianas });
  await r.contexto.revisarFotos();
  assert.deepEqual(r.bajadas, ['a/grande.jpg', 'a/sin-mini.jpg', 'b/bien.jpg', 'b/grande.webp'], 'Un formato desconocido no se baja');
  assert.deepEqual(r.subidas(), [['a/grande.jpg', 'optimizar'], ['a/sin-mini.jpg', 'miniatura'], ['b/grande.webp', 'optimizar']]);
  const optimizada = r.pedidos.find(([, c]) => c?.accion === 'optimizar')[1];
  assert.deepEqual(optimizada, { id: 'a', ruta: 'a/grande.jpg', accion: 'optimizar', archivo: 'data:x;base64,' + 320 * KB });
  assert.deepEqual(r.eventos, ['wp-ejemplos-actualizados']);
  assert.deepEqual(r.toasts, [['Fotos al día: 2 fotos achicadas (2,1 MB → 520 KB) y 1 miniatura nueva', 'ct']]);
  const e = r.estado();
  assert.equal(e.lista, true);
  assert.deepEqual(e.vistas, { 'b/bien.jpg': 450 * KB }, 'Se anota la que se miró y no se pudo mejorar; una liviana sin miniatura no se mira para achicar');
});

await probar('no vuelve a correr en el día, y después no repite lo ya mirado', async () => {
  const r = crear({ fotos, livianas });
  await r.contexto.revisarFotos();
  const pedidos = r.pedidos.length;
  r.reloj.ahora += 23 * 3600 * 1000;
  await r.contexto.revisarFotos();
  assert.equal(r.pedidos.length, pedidos, 'Dentro de las 24 h no pide nada');
  r.reloj.ahora += 3600 * 1000;
  r.bajadas.length = 0;
  // El servidor ya no lista las achicadas; las anotadas siguen igual.
  const siguen = [{ ...fotos[2] }, { id: 'b', ruta: 'b/cambio.jpg', bytes: 700 * KB, mini: true, pesada: true, url: 'u6' }];
  const otra = crear({ fotos: siguen, livianas, guardado: r.estado(), ahora: r.reloj.ahora });
  await otra.contexto.revisarFotos();
  assert.deepEqual(otra.bajadas, ['b/cambio.jpg'], 'Lo anotado con el mismo peso no se vuelve a bajar');
  assert.deepEqual(otra.estado().vistas, { 'b/bien.jpg': 450 * KB, 'b/cambio.jpg': 700 * KB });
  assert.deepEqual(otra.toasts, [], 'Sin cambios no avisa');
  // Si una anotada cambia de peso, se vuelve a mirar; lo que ya no está, se olvida.
  otra.reloj.ahora += 25 * 3600 * 1000;
  const tercera = crear({ fotos: [{ ...fotos[2], bytes: 460 * KB }], livianas, guardado: otra.estado(), ahora: otra.reloj.ahora });
  await tercera.contexto.revisarFotos();
  assert.deepEqual(tercera.bajadas, ['b/bien.jpg']);
  assert.deepEqual(tercera.estado().vistas, { 'b/bien.jpg': 460 * KB });
});

await probar('no corre en el celular ni con ahorro de datos', async () => {
  for (const opciones of [{ pointer: 'coarse' }, { saveData: true }]) {
    const r = crear({ fotos, livianas, ...opciones });
    await r.contexto.revisarFotos();
    assert.equal(r.pedidos.length, 0);
    assert.equal(r.estado(), null);
  }
});

await probar('una revisión cortada se retoma a los 10 minutos, no antes', async () => {
  const ahora = 1e12;
  const cortada = { desde: ahora - 9 * 60 * 1000, lista: false, vistas: {} };
  const r = crear({ fotos, livianas, guardado: cortada, ahora });
  await r.contexto.revisarFotos();
  assert.equal(r.pedidos.length, 0);
  r.reloj.ahora += 60 * 1000;
  await r.contexto.revisarFotos();
  assert.ok(r.pedidos.length > 0);
});

await probar('sin WebP achica JPEG y PNG; miniaturas y WebP quedan para otro navegador', async () => {
  const r = crear({ fotos, livianas, webp: false });
  await r.contexto.revisarFotos();
  assert.deepEqual(r.bajadas, ['a/grande.jpg', 'b/bien.jpg']);
  assert.deepEqual(r.subidas(), [['a/grande.jpg', 'optimizar']]);
  assert.deepEqual(r.estado().vistas, { 'b/bien.jpg': 450 * KB });
});

await probar('un fallo en una foto no frena las demás ni la anota', async () => {
  const r = crear({ fotos, livianas, falla: { bajar: 'a/grande.jpg' } });
  await r.contexto.revisarFotos();
  assert.deepEqual(r.subidas(), [['a/sin-mini.jpg', 'miniatura'], ['b/grande.webp', 'optimizar']]);
  assert.equal(r.estado().vistas['a/grande.jpg'], undefined);
  const s = crear({ fotos, livianas, falla: { subida: true } });
  await s.contexto.revisarFotos();
  assert.deepEqual(s.toasts, [], 'Sin nada subido no avisa');
  assert.equal(s.estado().lista, true);
});

await probar('si el listado falla, se reintenta en la próxima carga pasados 10 minutos', async () => {
  const r = crear({ fotos, livianas, falla: { listado: true } });
  await r.contexto.revisarFotos();
  assert.deepEqual(r.estado().lista, false);
  assert.equal(r.bajadas.length, 0);
});

await probar('se programa 20 s después y no corre en dos pestañas a la vez', async () => {
  const pedidosLock = [];
  let libre = true;
  const locks = { request: async (nombre, opciones, f) => { pedidosLock.push([nombre, opciones.ifAvailable]); return f(libre ? {} : null); } };
  const r = crear({ fotos, livianas, locks });
  r.contexto.programarRevisionFotos();
  assert.equal(r.timers.length, 1);
  assert.equal(r.timers[0].ms, 20000);
  assert.equal(r.pedidos.length, 0, 'Nada antes de tiempo');
  libre = false;
  await r.timers[0].f();
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(pedidosLock, [['wp-revisar-fotos', true]]);
  assert.equal(r.pedidos.length, 0, 'Otra pestaña tiene la revisión');
  libre = true;
  await r.timers[0].f();
  for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok));
  assert.ok(r.subidas().length > 0);
});

console.log(casos + ' casos de la revisión automática de fotos OK');
for (const p of problemas) console.error('FALLO: ' + p.nombre + '\n' + p.mensaje);
if (problemas.length) process.exitCode = 1;
