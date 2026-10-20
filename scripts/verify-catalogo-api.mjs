#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GRATIS } from '../api/_access.js';
import { applyCors } from '../api/_cors.js';
import { usuarioAdmin } from '../api/_admin.js';
import { bearer } from '../api/_sesion.js';
import { prepararSesiones, cabecerasSesion } from './_sesiones-prueba.mjs';

// /api/catalog contra una base sintética: la caché pública sólo puede salir
// de un pedido sin sesión, y con sesión la respuesta nunca es compartible.
function cargarHandler(db) {
  const ruta = new URL('../api/catalog.js', import.meta.url);
  const fuente = readFileSync(ruta, 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^const supabase = createClient\([^\n]+\);\r?\n/m, '')
    .replace('export default async function handler(', 'async function handler(');
  const fabrica = vm.compileFunction(fuente + '\nreturn handler;',
    ['supabase', 'applyCors', 'usuarioAdmin', 'bearer', 'GRATIS', 'console'],
    { filename: ruta.pathname });
  return fabrica(db, applyCors, usuarioAdmin, bearer, GRATIS, { error: (...a) => db.errores.push(a) });
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
            if (db.fallar === tabla) return { data: null, error: { message: 'fallo-sintetico' } };
            let filas = db.tablas[tabla].filter(r => filtros.every(f => f(r)));
            for (const [c, o] of [...ordenes].reverse()) {
              filas.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (o.ascending ? 1 : -1));
            }
            // PostgREST corta en 1000 filas aunque se pida más.
            filas = rango ? filas.slice(rango[0], Math.min(rango[1] + 1, rango[0] + 1000)) : filas.slice(0, 1000);
            const salida = filas.map(r => {
              if (tabla === 'sessions') return { ...r, users: db.tablas.users.find(u => u.id === r.user_id) };
              if (campos === '*') return { ...r };
              return Object.fromEntries(campos.split(',').map(c => c.trim()).map(c => [c, r[c]]));
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

async function pedir(handler, token, query = {}, method = 'GET') {
  const res = {
    codigo: 200, cabeceras: {}, cuerpo: undefined,
    setHeader(k, v) { this.cabeceras[k.toLowerCase()] = v; },
    status(c) { this.codigo = c; return this; },
    json(c) { this.cuerpo = c; return this; }, end() { return this; },
  };
  await handler({ method, headers: cabecerasSesion(token), query }, res);
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
    const contexto = vm.createContext({ API_BASE: base, CATALOG_BUILT_AT: '', KEY_SESSION: 'marca',
      localStorage: { getItem: () => marca }, fetch: async (url, opciones) => { pedido={url,opciones}; return {ok:true,json:async()=>({})}; } });
    vm.runInContext(bloque, contexto);
    await contexto.pedirCatalogo();
    assert.equal(pedido.opciones.cache, base ? 'default' : 'no-store');
    assert.equal(pedido.url.includes('&cuenta=1'), !base);
    assert.equal(pedido.opciones.headers.Authorization, undefined);
  }
});

await probar('la URL de cuenta es privada incluso antes de validar la cookie', async () => {
  const r=await pedir(handler,null,{cuenta:'1'});
  assert.equal(r.cabeceras['cache-control'],'private, no-store');
  assert.equal(r.cabeceras['vercel-cdn-cache-control'],undefined);
  assert.equal(r.cuerpo.esAdmin,false);
});

console.log(casos + ' casos de caché y contenido de /api/catalog OK');
for (const p of problemas) console.error('FALLO: ' + p.nombre + '\n' + p.mensaje);
if (problemas.length) process.exitCode = 1;
