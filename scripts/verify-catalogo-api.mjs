#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GRATIS } from '../api/_access.js';
import { applyCors } from '../api/_cors.js';
import { usuarioAdmin } from '../api/_admin.js';
import { bearer } from '../api/_sesion.js';
import { prepararSesiones, cabecerasSesion } from './_sesiones-prueba.mjs';
import { limitar } from '../api/_limite.js';

// /api/catalog contra una base sintética: la caché pública sólo puede salir
// de un pedido sin sesión, y con sesión la respuesta nunca es compartible.
function cargarHandler(db, reloj = Date) {
  const ruta = new URL('../api/catalog.js', import.meta.url);
  const fuente = readFileSync(ruta, 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^const supabase = createClient\([^\n]+\);\r?\n/m, '')
    .replace('export default async function handler(', 'async function handler(');
  const fabrica = vm.compileFunction(fuente + '\nreturn handler;',
    ['supabase', 'applyCors', 'usuarioAdmin', 'bearer', 'GRATIS', 'console', 'limitar', 'Date'],
    { filename: ruta.pathname });
  return fabrica(db, applyCors, usuarioAdmin, bearer, GRATIS, { error: (...a) => db.errores.push(a) }, limitar, reloj);
}

/** Un Date cuyo now() lo decide la prueba. */
function relojDe(ahora) {
  return class extends Date { static now() { return ahora(); } };
}

function crearBase() {
  const futuro = new Date(Date.now() + 86400000).toISOString();
  const db = {
    consultas: 0, errores: [], fallar: null,
    tablas: {
      users: [{ id: 'full', tier: 'full' }, { id: 'admin', tier: 'free', is_admin: true }],
      sessions: [
        { token: 'full', user_id: 'full', expires_at: futuro },
        { token: 'admin', user_id: 'admin', expires_at: futuro },
        { token: 'vencida', user_id: 'admin', expires_at: '2020-01-01T00:00:00Z' },
      ],
      categories: [], prompt_bodies: [], deleted_categories: [{ id: 'retirada' }],
      category_examples: [{ cat_id: 'publica-0', ruta: 'publica-0/1.webp' }, { cat_id: 'publica-0', ruta: 'publica-0/2.webp' }],
    },
    from(tabla) {
      const filtros = [], ordenes = [];
      let campos = '*', rango, singular = false;
      const q = {
        select(c) { campos = c; return q; },
        eq(c, v) { filtros.push(r => r[c] === v); return q; },
        gt(c, v) { filtros.push(r => String(r[c]) > v); return q; },
        in(c, v) { filtros.push(r => v.includes(r[c])); return q; },
        order(c, o) { ordenes.push([c, o]); return q; },
        range(a, b) { rango = [a, b]; return q; },
        single() { singular = true; return q; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            db.consultas++;
            // Como PostgREST: las variantes pueden venir dentro de cada
            // categoría, si la base conoce la clave foránea.
            const embebidas = campos.includes('prompt_bodies(');
            if (db.fallar === tabla || (embebidas && db.fallar === 'prompt_bodies')) return { data: null, error: { message: 'fallo-sintetico' } };
            if (embebidas && db.sinRelacion) return { data: null, error: { code: 'PGRST200', message: 'Could not find a relationship' } };
            let filas = db.tablas[tabla].filter(r => filtros.every(f => f(r)));
            for (const [c, o] of [...ordenes].reverse()) {
              filas.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (o.ascending ? 1 : -1));
            }
            // PostgREST corta en 1000 filas aunque se pida más.
            filas = rango ? filas.slice(rango[0], Math.min(rango[1] + 1, rango[0] + 1000)) : filas.slice(0, 1000);
            const salida = filas.map(r => {
              if (tabla === 'sessions') return { ...r, users: db.tablas.users.find(u => u.id === r.user_id) };
              if (campos === '*') return { ...r };
              const fila = Object.fromEntries(campos.split(',').map(c => c.trim()).filter(c => !c.includes('(')).map(c => [c, r[c]]));
              // Sin límite de 1000: el corte de PostgREST es sobre las filas de arriba.
              if (embebidas) fila.prompt_bodies = db.tablas.prompt_bodies.filter(p => p.cat_id === r.id).map(p => ({ variant: p.variant }));
              return fila;
            });
            return { data: singular ? (salida[0] || null) : salida, error: null };
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  // 300 publicadas con 6 variantes: más de 1000 filas, para el paginado.
  for (let i = 0; i < 300; i++) {
    db.tablas.categories.push({ id: 'publica-' + i, tier: 'casual', status: 'publicada', ready: true, sort_order: i, name: 'P' + i, sub: '', updated_at: '2026-10-0' + (1 + (i % 9)) + 'T00:00:00Z' });
  }
  db.tablas.categories.push({ id: 'borrador-x', tier: 'hot', status: 'borrador', ready: false, sort_order: 999, name: 'B', sub: '', updated_at: '2026-10-09T00:00:00Z' });
  for (const c of db.tablas.categories) {
    for (const variant of ['prompt', 'prompt2', 'duoPrompt', 'duoPrompt2', 'trioPrompt', 'trioPrompt2']) {
      db.tablas.prompt_bodies.push({ cat_id: c.id, variant, body: 'MARCADOR' });
    }
  }
  return prepararSesiones(db);
}

async function pedir(handler, token, query = {}, method = 'GET', cabeceras = {}) {
  const res = {
    codigo: 200, cabeceras: {}, cuerpo: undefined,
    setHeader(k, v) { this.cabeceras[k.toLowerCase()] = v; },
    status(c) { this.codigo = c; return this; },
    json(c) { this.cuerpo = c; return this; }, end() { return this; },
  };
  await handler({ method, headers: cabecerasSesion(token, cabeceras), query }, res);
  return res;
}

let casos = 0;
const problemas = [];
async function probar(nombre, fn) {
  try { await fn(); casos++; } catch (e) { problemas.push({ nombre, mensaje: e.message }); }
}

const db = crearBase(), handler = cargarHandler(db);

await probar('sin sesión: caché pública en navegador y CDN, sólo publicadas', async () => {
  const r = await pedir(handler, null);
  assert.equal(r.codigo, 200);
  assert.equal(r.cabeceras['cache-control'], 'public, max-age=60');
  assert.match(r.cabeceras['vercel-cdn-cache-control'], /max-age=300/);
  assert.match(r.cabeceras['vercel-cdn-cache-control'], /stale-while-revalidate=/);
  assert.equal(r.cabeceras.vary, 'Origin');
  assert.equal(r.cuerpo.esAdmin, false);
  assert.equal(r.cuerpo.categorias.length, 300);
  assert.ok(!r.cuerpo.categorias.some(c => c.status !== 'publicada'));
});

await probar('el paginado conserva las variantes de todas (más de 1000 filas)', async () => {
  const r = await pedir(handler, null);
  assert.ok(r.cuerpo.categorias.every(c => c.variants.length === 6), 'Alguna quedó sin variantes');
  assert.deepEqual(r.cuerpo.eliminadas, ['retirada']);
  assert.deepEqual(r.cuerpo.conEjemplos, ['publica-0']);
  assert.deepEqual(r.cuerpo.gratis, GRATIS);
});

for (const token of ['full', 'vencida', 'inventada']) {
  await probar('con sesión (' + token + '): nunca compartible y sin borradores', async () => {
    const r = await pedir(handler, token);
    assert.equal(r.codigo, 200);
    assert.equal(r.cabeceras['cache-control'], 'private, no-store');
    assert.equal(r.cabeceras['vercel-cdn-cache-control'], undefined);
    assert.equal(r.cuerpo.esAdmin, false);
    assert.ok(!r.cuerpo.categorias.some(c => c.id === 'borrador-x'), 'Un borrador salió para quien no es admin');
  });
}

await probar('admin: borradores incluidos y respuesta privada', async () => {
  const r = await pedir(handler, 'admin');
  assert.equal(r.cabeceras['cache-control'], 'private, no-store');
  assert.equal(r.cabeceras['vercel-cdn-cache-control'], undefined);
  assert.equal(r.cuerpo.esAdmin, true);
  assert.ok(r.cuerpo.categorias.some(c => c.id === 'borrador-x'));
  assert.equal(r.cuerpo.categorias.find(c => c.id === 'borrador-x').variants.length, 6);
});

await probar('las variantes llegan con las categorías: un solo viaje, sin cuerpos', async () => {
  for (const token of [null, 'admin']) {
    const orden = [];
    const original = db.from.bind(db);
    db.from = tabla => { orden.push(tabla); return original(tabla); };
    const r = await pedir(handler, token, token ? { cuenta: '1' } : {});
    db.from = original;
    assert.equal(r.codigo, 200);
    assert.ok(!orden.includes('prompt_bodies'), 'No hay una consulta aparte de variantes');
    assert.ok(r.cuerpo.categorias.every(c => c.variants.length === 6));
    assert.deepEqual(r.cuerpo.categorias[0].variants, ['duoPrompt', 'duoPrompt2', 'prompt', 'prompt2', 'trioPrompt', 'trioPrompt2'], 'Orden estable');
    assert.ok(!JSON.stringify(r.cuerpo).includes('MARCADOR'), 'Nunca viaja un cuerpo');
    assert.ok(r.cuerpo.categorias.every(c => !('prompt_bodies' in c)));
  }
});

await probar('sin la relación en la base vuelve al camino en dos pasos', async () => {
  // Una instancia nueva: la de arriba ya tiene lo publicado en memoria.
  const handler = cargarHandler(db);
  db.sinRelacion = true;
  const errores = db.errores.length;
  const publica = await pedir(handler, null);
  const admin = await pedir(handler, 'admin', { cuenta: '1' });
  db.sinRelacion = false;
  assert.equal(publica.codigo, 200);
  assert.equal(publica.cuerpo.categorias.length, 300);
  assert.ok(publica.cuerpo.categorias.every(c => c.variants.length === 6), 'Las variantes siguen llegando');
  assert.equal(publica.cabeceras['cache-control'], 'public, max-age=60');
  assert.ok(admin.cuerpo.categorias.some(c => c.id === 'borrador-x' && c.variants.length === 6));
  assert.ok(db.errores.length > errores, 'Queda registrado para saber que falta la relación');
});

await probar('desde filtra por fecha de cambio', async () => {
  const r = await pedir(handler, null, { desde: '2026-10-08T12:00:00.000Z' });
  assert.ok(r.cuerpo.categorias.length > 0 && r.cuerpo.categorias.length < 300);
  assert.ok(r.cuerpo.categorias.every(c => c.id.startsWith('publica-')));
});

await probar('las consultas independientes no esperan en fila', async () => {
  // Con sesión: cuenta, categorías, lápidas y ejemplos en el primer turno.
  const orden = [];
  const original = db.from.bind(db);
  db.from = tabla => { orden.push(tabla); return original(tabla); };
  await pedir(handler, 'admin');
  db.from = original;
  const primeras = orden.slice(0, 4).sort();
  assert.deepEqual(primeras, ['categories', 'category_examples', 'deleted_categories', 'sessions']);
});

for (const tabla of ['categories', 'deleted_categories', 'category_examples', 'prompt_bodies']) {
  await probar('un fallo de ' + tabla + ' no queda en ninguna caché', async () => {
    // Una instancia nueva, sin copia anterior que entregar.
    const handler = cargarHandler(db);
    db.fallar = tabla;
    const r = await pedir(handler, null);
    db.fallar = null;
    assert.equal(r.codigo, 500);
    assert.equal(r.cabeceras['cache-control'], 'private, no-store');
    assert.equal(r.cabeceras['vercel-cdn-cache-control'], undefined);
  });
}

await probar('OPTIONS y métodos no permitidos no se cachean', async () => {
  for (const m of ['OPTIONS', 'POST']) {
    const r = await pedir(handler, null, {}, m);
    assert.equal(r.cabeceras['cache-control'], 'private, no-store');
    assert.equal(r.cabeceras['vercel-cdn-cache-control'], undefined);
  }
});

// La página también tiene que pedir sin caché del navegador cuando hay sesión.
await probar('la página no reutiliza la respuesta pública con sesión', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bloque = html.slice(html.indexOf('function pedirCatalogo('), html.indexOf('async function ensurePrompts('));
  for (const [base, marca] of [['', null], ['', 'marca-publica'], ['https://promt-iota.vercel.app', null]]) {
    let pedido;
    const contexto = vm.createContext({ API_BASE: base, CATALOG_BUILT_AT: '2099-01-01T00:00:00Z', KEY_SESSION: 'marca',
      AbortController, setTimeout, clearTimeout,
      localStorage: { getItem: () => marca }, fetch: async (url, opciones) => { pedido={url,opciones}; return {ok:true,json:async()=>({})}; } });
    vm.runInContext(bloque, contexto);
    await contexto.pedirCatalogo();
    assert.equal(pedido.opciones.cache, base ? 'default' : 'no-store');
    assert.equal(pedido.url.includes('&cuenta=1'), !base);
    assert.equal(pedido.opciones.headers.Authorization, undefined);
    await contexto.pedirCatalogo({actualizar:true});
    assert.equal(pedido.opciones.cache,'no-store');
    assert.ok(pedido.url.includes('&actualizar=1'));
    assert.equal(new URL(pedido.url,'https://ejemplo.invalid').searchParams.get('desde'),'','Actualizar no depende de un sello estático anterior o futuro');
  }
});

await probar('la URL de cuenta es privada incluso antes de validar la cookie', async () => {
  const r=await pedir(handler,null,{cuenta:'1'});
  assert.equal(r.cabeceras['cache-control'],'private, no-store');
  assert.equal(r.cabeceras['vercel-cdn-cache-control'],undefined);
  assert.equal(r.cuerpo.esAdmin,false);
});

await probar('actualización explícita: sin caché de navegador ni CDN y sin permiso de admin adicional', async () => {
  const r=await pedir(handler,null,{actualizar:'1'});
  assert.equal(r.codigo,200);
  assert.equal(r.cabeceras['cache-control'],'private, no-store');
  assert.equal(r.cabeceras['vercel-cdn-cache-control'],'no-store');
  assert.equal(r.cuerpo.esAdmin,false);
  assert.ok(r.cuerpo.categorias.every(c=>c.status==='publicada'));
});

// Un dispositivo que repite el pedido saltando el CDN (cuenta=1, actualizar=1,
// un desde distinto, cookies inventadas) no puede hacer que la base trabaje
// en cada pedido: sin admin se lee lo publicado una vez cada 30 s.
function contarTablas(base) {
  const tablas = [];
  const original = base.from.bind(base);
  base.from = tabla => { tablas.push(tabla); return original(tabla); };
  return { tablas, catalogo: () => tablas.filter(t => t !== 'sessions').length, restaurar: () => { base.from = original; } };
}

await probar('sin admin la base se lee una sola vez aunque se repita saltando el CDN', async () => {
  const b = crearBase(), h = cargarHandler(b), c = contarTablas(b);
  try {
    for (let i = 0; i < 40; i++) {
      const token = [null, 'full', 'inventada', 'vencida'][i % 4];
      const query = [{ cuenta: '1' }, { actualizar: '1' }, { desde: '2026-10-0' + (1 + (i % 9)) + 'T00:00:00Z' }, { cuenta: '1', actualizar: '1', desde: 'x' + i }][i % 4];
      const r = await pedir(h, token, query);
      assert.equal(r.codigo, 200);
      assert.equal(r.cuerpo.esAdmin, false);
      assert.ok(!r.cuerpo.categorias.some(c => c.status !== 'publicada'));
    }
  } finally { c.restaurar(); }
  assert.equal(c.catalogo(), 3, 'Se leyeron ' + c.catalogo() + ' tablas del catálogo en 40 pedidos');
});

await probar('los pedidos simultáneos comparten una sola lectura', async () => {
  const b = crearBase(), h = cargarHandler(b), c = contarTablas(b);
  try { await Promise.all(Array.from({ length: 20 }, () => pedir(h, null, { cuenta: '1' }))); } finally { c.restaurar(); }
  assert.equal(c.catalogo(), 3);
});

await probar('desde se filtra en la copia: mismo resultado que en la base', async () => {
  const b = crearBase(), h = cargarHandler(b);
  for (const desde of ['2026-10-03T12:00:00.000Z', '2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z', '2099-01-01T00:00:00Z', 'no-es-fecha']) {
    const r = await pedir(h, null, { desde });
    const fecha = Number.isNaN(Date.parse(desde)) ? null : Date.parse(desde);
    const esperadas = b.tablas.categories.filter(c => c.status === 'publicada' && (fecha == null || Date.parse(c.updated_at) > fecha)).map(c => c.id);
    assert.deepEqual(r.cuerpo.categorias.map(c => c.id), esperadas, 'desde=' + desde);
    assert.ok(r.cuerpo.categorias.every(c => !('actualizada' in c)), 'El campo interno no se responde');
  }
});

await probar('el admin lee siempre de la base y ve sus borradores enseguida', async () => {
  const b = crearBase(), h = cargarHandler(b), c = contarTablas(b);
  try {
    await pedir(h, null);
    b.tablas.categories.push({ id: 'nuevo-borrador', tier: 'casual', status: 'borrador', ready: false, sort_order: 1000, name: 'N', sub: '', updated_at: '2026-10-09T00:00:00Z' });
    const r = await pedir(h, 'admin', { cuenta: '1' });
    assert.ok(r.cuerpo.categorias.some(c => c.id === 'nuevo-borrador'));
    await pedir(h, 'admin', { cuenta: '1' });
  } finally { c.restaurar(); }
  assert.equal(c.catalogo(), 9, 'Una lectura pública y dos del admin');
});

await probar('la copia vence a los 30 s y trae lo publicado después', async () => {
  let ahora = Date.parse('2026-11-27T12:00:00Z');
  const b = crearBase(), h = cargarHandler(b, relojDe(() => ahora)), c = contarTablas(b);
  try {
    await pedir(h, null, { cuenta: '1' });
    b.tablas.categories.push({ id: 'recien-publicada', tier: 'casual', status: 'publicada', ready: true, sort_order: 1001, name: 'R', sub: '', updated_at: '2026-10-09T00:00:00Z' });
    ahora += 29 * 1000;
    assert.ok(!(await pedir(h, null, { cuenta: '1' })).cuerpo.categorias.some(c => c.id === 'recien-publicada'));
    ahora += 2 * 1000;
    assert.ok((await pedir(h, null, { cuenta: '1' })).cuerpo.categorias.some(c => c.id === 'recien-publicada'));
  } finally { c.restaurar(); }
  assert.equal(c.catalogo(), 6);
});

await probar('si Supabase falla, se entrega la última copia buena hasta 10 minutos', async () => {
  let ahora = Date.parse('2026-11-27T12:00:00Z');
  const b = crearBase(), h = cargarHandler(b, relojDe(() => ahora));
  assert.equal((await pedir(h, null, { cuenta: '1' })).codigo, 200);
  b.fallar = 'categories';
  ahora += 5 * 60 * 1000;
  const respaldo = await pedir(h, null, { cuenta: '1' });
  assert.equal(respaldo.codigo, 200);
  assert.equal(respaldo.cuerpo.categorias.length, 300);
  ahora += 6 * 60 * 1000;
  const vencido = await pedir(h, null);
  b.fallar = null;
  assert.equal(vencido.codigo, 500);
  assert.equal(vencido.cabeceras['cache-control'], 'private, no-store');
  assert.equal(vencido.cabeceras['vercel-cdn-cache-control'], undefined);
});

// Un dispositivo que lo pide en bucle recibe 429 antes de llegar a la base;
// el 429 nunca queda en el CDN, ni siquiera desde el enlace público.
await probar('un dispositivo en bucle recibe 429 y los demás siguen', async () => {
  const db = crearBase(), handler = cargarHandler(db);
  for (const [i, query] of [{}, { actualizar: '1' }, { cuenta: '1', desde: '2026-10-05T00:00:00Z' }].entries()) {
    const ip = '203.0.113.' + (40 + i);
    for (let n = 0; n < 60; n++) assert.equal((await pedir(handler, null, query, 'GET', { 'x-real-ip': ip })).codigo, 200);
    const antes = db.consultas;
    const cortado = await pedir(handler, null, query, 'GET', { 'x-real-ip': ip });
    assert.equal(cortado.codigo, 429);
    assert.equal(cortado.cuerpo.error, 'demasiados_pedidos');
    assert.ok(Number(cortado.cabeceras['retry-after']) >= 1);
    assert.equal(cortado.cabeceras['cache-control'], 'private, no-store');
    assert.equal(cortado.cabeceras['vercel-cdn-cache-control'], undefined);
    assert.equal(db.consultas, antes, 'El rechazo no consulta la base');
    assert.equal((await pedir(handler, null, query, 'GET', { 'x-real-ip': '203.0.113.' + (140 + i) })).codigo, 200);
  }
  // El preflight no se cuenta.
  for (let n = 0; n < 70; n++) assert.equal((await pedir(handler, null, {}, 'OPTIONS', { 'x-real-ip': '203.0.113.99' })).codigo, 200);
});

console.log(casos + ' casos de caché y contenido de /api/catalog OK');
for (const p of problemas) console.error('FALLO: ' + p.nombre + '\n' + p.mensaje);
if (problemas.length) process.exitCode = 1;
