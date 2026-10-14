#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GRATIS, canAccess } from '../api/_access.js';
import { applyCors } from '../api/_cors.js';
import { bearer, resolveTier } from '../api/_sesion.js';
import { crearBaseVersiones } from './verify-versiones.mjs';

// Se ejecutan los handlers de producción contra una base sintética. Las
// plantillas son sólo marcadores: no se leen, copian ni generan prompts reales.
function cargarHandler(nombre, db) {
  const ruta = new URL('../api/' + nombre + '.js', import.meta.url);
  const original = readFileSync(ruta, 'utf8');
  assert.match(original, /export default async function handler\(/);
  const fuente = original
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^const supabase = createClient\([^\n]+\);\r?\n/m, '')
    .replace('export default async function handler(', 'async function handler(');
  const fabrica = vm.compileFunction(fuente + '\nreturn handler;',
    ['supabase', 'canAccess', 'applyCors', 'bearer', 'resolveTier', 'resolverSesion', 'console'],
    { filename: ruta.pathname });
  return fabrica(db, canAccess, applyCors, bearer, resolveTier, resolveTier,
    { error: (...args) => db.errores.push(args) });
}

const VARIANTES = ['prompt', 'prompt2', 'duoPrompt', 'duoPrompt2', 'trioPrompt', 'trioPrompt2'];
function base() {
  const db = crearBaseVersiones();
  const futuro = new Date(Date.now() + 86400000).toISOString();
  db.tablas.users = [
    { id: 'gratis', tier: 'free' }, { id: 'premium', tier: 'premium' },
    { id: 'full', tier: 'full' }, { id: 'admin', tier: 'free', is_admin: true },
  ];
  db.tablas.sessions = db.tablas.users.map(u => ({ token: u.id, user_id: u.id, expires_at: futuro }));
  db.tablas.sessions.push(
    { token: 'vencida', user_id: 'full', expires_at: '2020-01-01T00:00:00Z' },
    { token: 'fecha-invalida', user_id: 'full', expires_at: 'invalida' },
  );
  db.tablas.categories = [
    { id: GRATIS[0], tier: 'casual', status: 'publicada', ready: true, sort_order: 0 },
    { id: 'editorial-auditoria', tier: 'editorial', status: 'publicada', ready: true, sort_order: 1 },
    { id: 'hot-auditoria', tier: 'hot', status: 'publicada', ready: true, sort_order: 2 },
    { id: 'intimo-auditoria', tier: 'xxx', status: 'publicada', ready: true, sort_order: 3 },
    { id: 'borrador-auditoria', tier: 'casual', status: 'borrador', ready: false, sort_order: 4 },
    { id: 'prueba-auditoria', tier: 'editorial', status: 'prueba', ready: false, sort_order: 5 },
  ];
  db.tablas.prompt_bodies = db.tablas.categories.flatMap(c =>
    VARIANTES.map(variant => ({
      cat_id: c.id, variant, body: 'MARCADOR-SINTETICO-' + c.id + '-' + variant,
    })));
  db.tablas.category_examples = db.tablas.categories.map(c => ({ cat_id: c.id, ruta: c.id + '/1.webp', orden: 0 }));
  db.firmas = [];
  db.errores = [];
  db.storage = { from(bucket) { return { async createSignedUrls(rutas, segundos) {
    db.firmas.push({ bucket, rutas, segundos });
    return { data: rutas.map(ruta => ({ signedUrl: 'https://ejemplo.invalid/' + ruta })), error: null };
  } }; } };
  return db;
}

async function pedir(handler, token, query, method = 'GET') {
  const res = {
    codigo: 200, cabeceras: {}, cuerpo: undefined,
    setHeader(k, v) { this.cabeceras[k.toLowerCase()] = v; },
    status(c) { this.codigo = c; return this; },
    json(c) { this.cuerpo = c; return this; }, end() { return this; },
  };
  await handler({ method, headers: { authorization: token ? 'Bearer ' + token : '', origin: 'https://wallpaperia.github.io' }, query }, res);
  return res;
}

const db = base(), prompts = cargarHandler('prompt', db), fotos = cargarHandler('ejemplos', db);
let casos = 0;
const problemas = [];
async function probar(nombre, fn) {
  try { await fn(); casos++; }
  catch (e) { problemas.push({ nombre, mensaje: e.message }); }
}

const visitantes = [
  { token: null, prompts: [GRATIS[0]], fotos: [GRATIS[0], 'editorial-auditoria'] },
  { token: 'gratis', prompts: [GRATIS[0]], fotos: [GRATIS[0], 'editorial-auditoria'] },
  { token: 'premium', prompts: [GRATIS[0], 'editorial-auditoria', 'hot-auditoria'], fotos: [GRATIS[0], 'editorial-auditoria', 'hot-auditoria'] },
  { token: 'full', prompts: [GRATIS[0], 'editorial-auditoria', 'hot-auditoria', 'intimo-auditoria'], fotos: [GRATIS[0], 'editorial-auditoria', 'hot-auditoria', 'intimo-auditoria'] },
  { token: 'admin', prompts: db.tablas.categories.map(c => c.id), fotos: db.tablas.categories.map(c => c.id) },
  ...['vencida', 'fecha-invalida', 'inventada'].map(token => ({ token, prompts: [GRATIS[0]], fotos: [GRATIS[0], 'editorial-auditoria'] })),
];
for (const visitante of visitantes) {
  for (const cat of db.tablas.categories) {
    const oculto = cat.status !== 'publicada' && visitante.token !== 'admin';
    await probar('prompt ' + (visitante.token || 'visitante') + ' / ' + cat.id, async () => {
      const r = await pedir(prompts, visitante.token, { id: cat.id, tier: 'full', esAdmin: true });
      assert.equal(r.codigo, oculto ? 404 : visitante.prompts.includes(cat.id) ? 200 : 403);
      assert.equal(r.cabeceras['cache-control'], 'private, no-store');
      if (r.codigo === 200) assert.deepEqual(Object.keys(r.cuerpo.prompts), VARIANTES);
      else assert.equal(r.cuerpo.prompts, undefined);
    });
    await probar('foto ' + (visitante.token || 'visitante') + ' / ' + cat.id, async () => {
      const firmas = db.firmas.length;
      const r = await pedir(fotos, visitante.token, { id: cat.id, tier: 'full', esAdmin: true });
      assert.equal(r.codigo, oculto ? 404 : visitante.fotos.includes(cat.id) ? 200 : 403);
      if (r.codigo !== 200) {
        assert.equal(r.cabeceras['cache-control'], 'private, no-store');
        assert.equal(r.cuerpo.imagenes, undefined);
        assert.equal(db.firmas.length, firmas, 'El rechazo no debe firmar ninguna URL');
      } else {
        assert.equal(r.cuerpo.imagenes.length, 1);
        assert.equal(db.firmas.at(-1).segundos, 1800);
      }
    });
  }
  await probar('todas / ' + (visitante.token || 'visitante'), async () => {
    const r = await pedir(prompts, visitante.token, { todas: '1', tier: 'full', esAdmin: true });
    assert.equal(r.codigo, 200);
    assert.equal(r.cabeceras['cache-control'], 'private, no-store');
    assert.deepEqual(Object.keys(r.cuerpo.prompts), visitante.prompts);
    assert.ok(Object.values(r.cuerpo.prompts).every(x => x.endsWith('-prompt')), 'El paquete sólo incluye la variante Solo');
  });
}

// Una edición del panel cambia el permiso enseguida. Se conserva el mismo
// handler caliente para detectar si reutiliza estado de antes de la edición.
const cambios = base(), permisosActuales = cargarHandler('prompt', cambios);
await pedir(permisosActuales, 'full', { id: 'hot-auditoria' });
await probar('despublicar cierra el prompt en un handler caliente', async () => {
  cambios.tablas.categories.find(c => c.id === 'hot-auditoria').status = 'borrador';
  const r = await pedir(permisosActuales, 'full', { id: 'hot-auditoria' });
  assert.equal(r.codigo, 404);
  assert.equal(r.cuerpo.prompts, undefined);
});
await probar('reclasificar de Hot a Íntimo exige Full enseguida', async () => {
  const cat = cambios.tablas.categories.find(c => c.id === 'hot-auditoria');
  cat.status = 'publicada'; cat.tier = 'xxx';
  const r = await pedir(permisosActuales, 'premium', { id: cat.id });
  assert.equal(r.codigo, 403);
  assert.equal(r.cuerpo.prompts, undefined);
});
await probar('el paquete de todas también usa los permisos actuales', async () => {
  cambios.tablas.categories.find(c => c.id === GRATIS[0]).status = 'borrador';
  const r = await pedir(permisosActuales, 'premium', { todas: '1' });
  assert.equal(r.codigo, 200);
  assert.deepEqual(Object.keys(r.cuerpo.prompts), ['editorial-auditoria']);
});
await probar('publicar un borrador lo abre sin esperar a que venza una caché', async () => {
  const cat = cambios.tablas.categories.find(c => c.id === 'borrador-auditoria');
  cat.status = 'publicada'; cat.ready = true;
  const r = await pedir(permisosActuales, 'full', { id: cat.id });
  assert.equal(r.codigo, 200);
  assert.deepEqual(Object.keys(r.cuerpo.prompts), VARIANTES);
});

for (const [nombre, handler] of [['prompt', prompts], ['foto', fotos]]) {
  await probar(nombre + ' identifica peticiones inválidas y métodos no permitidos', async () => {
    for (const id of ['', 'x'.repeat(101), ['id']]) assert.equal((await pedir(handler, 'full', { id })).codigo, 400);
    assert.equal((await pedir(handler, 'admin', { id: 'ausente' })).codigo, 404);
    assert.equal((await pedir(handler, 'full', { id: GRATIS[0] }, 'POST')).codigo, 405);
    assert.equal((await pedir(handler, null, {}, 'OPTIONS')).codigo, 200);
  });
}

await probar('las fotos públicas conservan la caché pública', async () => {
  const r = await pedir(fotos, null, { id: GRATIS[0] });
  assert.equal(r.cabeceras['cache-control'], 'public, max-age=600');
});
for (const id of ['borrador-auditoria', 'prueba-auditoria']) {
  await probar('la foto sin publicar nunca queda en caché pública / ' + id, async () => {
    const r = await pedir(fotos, 'admin', { id });
    assert.equal(r.codigo, 200);
    assert.equal(r.cabeceras['cache-control'], 'private, no-store');
  });
}
await probar('la galería Hot vacía conserva la respuesta privada', async () => {
  db.tablas.category_examples = db.tablas.category_examples.filter(x => x.cat_id !== 'hot-auditoria');
  const r = await pedir(fotos, 'premium', { id: 'hot-auditoria' });
  assert.equal(r.codigo, 200);
  assert.deepEqual(r.cuerpo.imagenes, []);
  assert.equal(r.cabeceras['cache-control'], 'private, no-store');
});
await probar('un fallo de Storage no entrega una URL', async () => {
  db.storage.from = () => ({ async createSignedUrls() { return { data: null, error: { message: 'fallo-sintetico' } }; } });
  const r = await pedir(fotos, 'full', { id: 'intimo-auditoria' });
  assert.equal(r.codigo, 500);
  assert.equal(r.cabeceras['cache-control'], 'private, no-store');
  assert.equal(r.cuerpo.error, 'server_error');
  assert.equal(r.cuerpo.imagenes, undefined);
  assert.equal(db.errores.length, 1, 'El detalle del fallo queda en el registro del servidor');
});

console.log(casos + ' casos de lectura, sesiones, variantes, estados y fotos OK');
for (const p of problemas) console.error('FALLO: ' + p.nombre + '\n' + p.mensaje);
if (problemas.length) process.exitCode = 1;
