#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GRATIS, canAccess } from '../api/_access.js';
import { applyCors } from '../api/_cors.js';
import { bearer, resolveTier } from '../api/_sesion.js';
import { rutaMiniatura } from '../api/_miniaturas.js';
import { crearBaseVersiones } from './verify-versiones.mjs';
import { prepararSesiones, cabecerasSesion } from './_sesiones-prueba.mjs';

// Se ejecutan los handlers de producción contra una base sintética. Las
// plantillas son sólo marcadores: no se leen, copian ni generan prompts reales.
function cargarHandler(nombre, db, reloj = Date) {
  const ruta = new URL('../api/' + nombre + '.js', import.meta.url);
  const original = readFileSync(ruta, 'utf8');
  assert.match(original, /export default async function handler\(/);
  const fuente = original
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^const supabase = createClient\([^\n]+\);\r?\n/m, '')
    .replace('export default async function handler(', 'async function handler(');
  const fabrica = vm.compileFunction(fuente + '\nreturn handler;',
    ['supabase', 'canAccess', 'applyCors', 'bearer', 'resolveTier', 'resolverSesion', 'rutaMiniatura', 'console', 'Date'],
    { filename: ruta.pathname });
  return fabrica(db, canAccess, applyCors, bearer, resolveTier, resolveTier, rutaMiniatura,
    { error: (...args) => db.errores.push(args) }, reloj);
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
  // Como Storage: una ruta inexistente vuelve sin URL y no hace fallar al lote.
  db.archivos = new Set(db.tablas.category_examples.map(e => e.ruta));
  db.storage = { from(bucket) { return { async createSignedUrls(rutas, segundos) {
    db.firmas.push({ bucket, rutas, segundos });
    return { data: rutas.map(ruta => db.archivos.has(ruta)
      ? { path: ruta, signedUrl: 'https://ejemplo.invalid/' + ruta, error: null }
      : { path: ruta, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' }), error: null };
  } }; } };
  return prepararSesiones(db);
}

async function pedir(handler, token, query, method = 'GET') {
  const res = {
    codigo: 200, cabeceras: {}, cuerpo: undefined,
    setHeader(k, v) { this.cabeceras[k.toLowerCase()] = v; },
    status(c) { this.codigo = c; return this; },
    json(c) { this.cuerpo = c; return this; }, end() { return this; },
  };
  await handler({ method, headers: cabecerasSesion(token), query }, res);
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
        assert.equal(r.cuerpo.miniaturas.length, 1);
        // Sin miniatura subida, la tarjeta usa la original.
        assert.equal(r.cuerpo.miniaturas[0], r.cuerpo.imagenes[0]);
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

// El lote de fotos: la primera de cada escena que ese visitante puede ver,
// con los mismos permisos que el pedido de a una. El tier y esAdmin que
// manda el cliente se ignoran.
for (const visitante of visitantes) {
  await probar('lote de fotos / ' + (visitante.token || 'visitante'), async () => {
    const b = base(), f = cargarHandler('ejemplos', b);
    const r = await pedir(f, visitante.token, { todas: '1', tier: 'full', esAdmin: true });
    assert.equal(r.codigo, 200);
    assert.deepEqual(Object.keys(r.cuerpo.fotos).sort(), [...visitante.fotos].sort());
    for (const [id, f] of Object.entries(r.cuerpo.fotos)) {
      assert.equal(f.imagen, 'https://ejemplo.invalid/' + id + '/1.webp');
      assert.equal(f.miniatura, f.imagen, 'Sin miniatura subida, se usa la original');
    }
    assert.equal(b.firmas.length, 1, 'Una sola firma para todas');
    const publica = !visitante.token;
    // Sin sesión son sólo Casual/Editorial: duran más para que el CDN pueda
    // servir la lista anterior mientras pide otra. El lote público se comparte
    // también con cuentas Free; los lotes pagos y admin duran 30 minutos.
    const soloPublicas = !['premium', 'full', 'admin'].includes(visitante.token);
    assert.equal(b.firmas.at(-1).segundos, soloPublicas ? 7200 : 1800);
    assert.equal(r.cabeceras['cache-control'], publica ? 'public, max-age=60' : 'private, no-store');
    assert.equal(r.cabeceras['vercel-cdn-cache-control'] !== undefined, publica, 'Sólo el lote sin sesión va al CDN');
    if (publica) {
      const cdn = r.cabeceras['vercel-cdn-cache-control'];
      const seg = k => Number(cdn.match(new RegExp(k + '=(\\d+)'))[1]);
      assert.ok(seg('max-age') + seg('stale-while-revalidate') + 15 * 60 + 2 * 60 + 5 * 60 < 7200,
        'Lo que entrega el CDN, aun vencido, sigue valiendo mientras la página lo usa');
      assert.ok(seg('stale-if-error') <= seg('stale-while-revalidate'));
    }
  });
}

await probar('lote de fotos con cuenta=1: mismo contenido, nunca en la caché compartida', async () => {
  const r = await pedir(fotos, null, { todas: '1', cuenta: '1' });
  assert.equal(r.codigo, 200);
  assert.equal(db.firmas.at(-1).segundos, 7200, 'El contenido público comparte las firmas aunque la respuesta HTTP sea privada');
  assert.deepEqual(Object.keys(r.cuerpo.fotos).sort(), [GRATIS[0], 'editorial-auditoria'].sort());
  assert.equal(r.cabeceras['cache-control'], 'private, no-store');
  assert.equal(r.cabeceras['vercel-cdn-cache-control'], undefined);
});

await probar('lote de fotos: miniatura, desempate igual a la galería y errores sin caché', async () => {
  let ahora = Date.now();
  const b = base(), f = cargarHandler('ejemplos', b, { now: () => ahora });
  const ruta = GRATIS[0] + '/1.webp';
  b.archivos.add(rutaMiniatura(ruta));
  // Dos fotos con el mismo orden: la tarjeta y la galería eligen la misma.
  b.tablas.category_examples.push({ cat_id: 'editorial-auditoria', ruta: 'editorial-auditoria/0.webp', orden: 0 });
  b.archivos.add('editorial-auditoria/0.webp');
  const r = await pedir(f, null, { todas: '1' });
  assert.equal(r.cuerpo.fotos[GRATIS[0]].miniatura, 'https://ejemplo.invalid/' + rutaMiniatura(ruta));
  const galeria = await pedir(f, null, { id: 'editorial-auditoria' });
  assert.equal(galeria.cuerpo.imagenes.length, 2);
  assert.equal(r.cuerpo.fotos['editorial-auditoria'].imagen, galeria.cuerpo.imagenes[0]);
  b.errores.category_examples = 'XX000';
  ahora += 60 * 1000;
  const fallo = await pedir(f, null, { todas: '1' });
  assert.equal(fallo.codigo, 500);
  assert.equal(fallo.cabeceras['cache-control'], 'private, no-store');
  assert.equal(fallo.cabeceras['vercel-cdn-cache-control'], undefined, 'Un error no queda en el CDN');
});

// Cuenta=1 y parámetros nuevos no generan claves de caché nuevas. Se cuentan
// lecturas y firmas reales del handler, sin golpear servicios de producción.
function contarConsultas(b) {
  const consultas = [];
  const from = b.from.bind(b);
  b.from = tabla => { consultas.push(tabla); return from(tabla); };
  return consultas;
}

await probar('repetir el lote público con cuenta=1, cookies falsas o parámetros al azar no repite el trabajo', async () => {
  const b = base(), f = cargarHandler('ejemplos', b), consultas = contarConsultas(b);
  const inicial = await pedir(f, null, { todas: '1' });
  for (const token of [null, 'gratis', 'inventada', 'vencida', 'fecha-invalida']) {
    const r = await pedir(f, token, { todas: '1', cuenta: '1', nonce: String(Math.random()), tier: 'full', esAdmin: true });
    assert.equal(r.codigo, 200);
    assert.deepEqual(r.cuerpo, inicial.cuerpo);
    assert.equal(r.cabeceras['cache-control'], 'private, no-store');
    assert.equal(r.cabeceras['vercel-cdn-cache-control'], undefined);
  }
  assert.equal(consultas.filter(t => t === 'categories').length, 1);
  assert.equal(consultas.filter(t => t === 'category_examples').length, 1);
  assert.equal(b.firmas.length, 1);
});

await probar('las peticiones públicas simultáneas comparten una sola lectura y firma', async () => {
  const b = base(), f = cargarHandler('ejemplos', b), consultas = contarConsultas(b);
  const respuestas = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    pedir(f, null, { todas: '1', ...(i % 2 ? { cuenta: '1' } : {}), nonce: String(i) })));
  assert.ok(respuestas.every(r => r.codigo === 200));
  assert.ok(respuestas.every(r => JSON.stringify(r.cuerpo) === JSON.stringify(respuestas[0].cuerpo)));
  assert.equal(consultas.length, 2);
  assert.equal(b.firmas.length, 1);
});

await probar('ningún lote pago ni admin entra en la copia pública, en ningún orden de llegada', async () => {
  for (const primero of [null, 'premium', 'full', 'admin']) {
    const b = base(), f = cargarHandler('ejemplos', b);
    await pedir(f, primero, { todas: '1', cuenta: '1' });
    for (const token of ['admin', null, 'full', 'gratis', 'premium', 'inventada', null]) {
      const r = await pedir(f, token, { todas: '1', cuenta: '1' });
      const esperado = visitantes.find(v => v.token === token).fotos;
      assert.deepEqual(Object.keys(r.cuerpo.fotos).sort(), [...esperado].sort());
      assert.equal(r.cabeceras['cache-control'], 'private, no-store');
      assert.equal(r.cabeceras['vercel-cdn-cache-control'], undefined);
    }
  }
});

await probar('vencer o revocar una sesión paga corta el lote privado aunque el handler esté caliente', async () => {
  const b = base(), f = cargarHandler('ejemplos', b);
  assert.ok((await pedir(f, 'full', { todas: '1', cuenta: '1' })).cuerpo.fotos['intimo-auditoria']);
  b.tablas.sessions.find(s => s.user_id === 'full').expires_at = '2020-01-01T00:00:00Z';
  const vencida = await pedir(f, 'full', { todas: '1', cuenta: '1' });
  assert.deepEqual(Object.keys(vencida.cuerpo.fotos).sort(), [GRATIS[0], 'editorial-auditoria'].sort());
  assert.ok((await pedir(f, 'premium', { todas: '1', cuenta: '1' })).cuerpo.fotos['hot-auditoria']);
  b.tablas.sessions = b.tablas.sessions.filter(s => s.user_id !== 'premium');
  const revocada = await pedir(f, 'premium', { todas: '1', cuenta: '1' });
  assert.deepEqual(revocada.cuerpo, vencida.cuerpo);
});

await probar('la copia pública vence al minuto y renueva fotos y permisos publicados', async () => {
  let ahora = Date.now();
  const b = base(), f = cargarHandler('ejemplos', b, { now: () => ahora });
  const original = await pedir(f, null, { todas: '1', cuenta: '1' });
  b.tablas.categories.find(c => c.id === GRATIS[0]).status = 'borrador';
  b.tablas.category_examples.find(e => e.cat_id === 'editorial-auditoria').ruta = 'editorial-auditoria/nueva.webp';
  b.archivos.add('editorial-auditoria/nueva.webp');
  ahora += 59999;
  assert.deepEqual((await pedir(f, null, { todas: '1', cuenta: '1' })).cuerpo, original.cuerpo);
  assert.equal(b.firmas.length, 1);
  ahora++;
  const renovada = await pedir(f, null, { todas: '1', cuenta: '1' });
  assert.deepEqual(Object.keys(renovada.cuerpo.fotos), ['editorial-auditoria']);
  assert.equal(renovada.cuerpo.fotos['editorial-auditoria'].imagen, 'https://ejemplo.invalid/editorial-auditoria/nueva.webp');
  assert.equal(b.firmas.length, 2);
});

await probar('un fallo de lectura o Storage no se cachea y la siguiente petición se recupera', async () => {
  for (const punto of ['categories', 'category_examples', 'storage']) {
    const b = base(), f = cargarHandler('ejemplos', b);
    const storageFrom = b.storage.from;
    if (punto === 'storage') b.storage.from = () => ({ async createSignedUrls() { return { error: { message: 'fallo-sintetico' } }; } });
    else b.errores[punto] = 'XX000';
    const fallo = await pedir(f, null, { todas: '1', cuenta: '1' });
    assert.equal(fallo.codigo, 500);
    assert.equal(fallo.cabeceras['cache-control'], 'private, no-store');
    assert.equal(fallo.cabeceras['vercel-cdn-cache-control'], undefined);
    delete b.errores[punto];
    b.storage.from = storageFrom;
    const recuperada = await pedir(f, null, { todas: '1', cuenta: '1' });
    assert.equal(recuperada.codigo, 200);
    assert.deepEqual(Object.keys(recuperada.cuerpo.fotos).sort(), [GRATIS[0], 'editorial-auditoria'].sort());
  }
});

await probar('lote de fotos: más de 1000 filas y firmas en tandas', async () => {
  const b = base(), f = cargarHandler('ejemplos', b);
  for (let i = 0; i < 550; i++) {
    const id = 'masiva-' + String(i).padStart(3, '0');
    b.tablas.categories.push({ id, tier: i % 2 ? 'casual' : 'hot', status: 'publicada', ready: true, sort_order: 10 + i });
    for (const n of [2, 1]) {
      b.tablas.category_examples.push({ cat_id: id, ruta: id + '/' + n + '.webp', orden: n });
      b.archivos.add(id + '/' + n + '.webp');
    }
  }
  const firmas = b.firmas.length;
  const r = await pedir(f, null, { todas: '1' });
  const ids = Object.keys(r.cuerpo.fotos);
  assert.equal(ids.length, 2 + 275, 'Sin sesión: las públicas, aunque haya más de 1000 filas');
  assert.ok(ids.every(id => !id.startsWith('masiva-') || Number(id.slice(-3)) % 2 === 1), 'Ninguna Hot sin sesión');
  assert.equal(r.cuerpo.fotos['masiva-549'].imagen, 'https://ejemplo.invalid/masiva-549/1.webp', 'La primera por orden, no por inserción');
  const tandas = b.firmas.slice(firmas);
  assert.ok(tandas.length > 1 && tandas.every(t => t.rutas.length <= 200), 'Las firmas van en tandas de hasta 200');
  const full = await pedir(f, 'full', { todas: '1' });
  assert.equal(Object.keys(full.cuerpo.fotos).length, 4 + 550);
  assert.equal(full.cuerpo.fotos['masiva-000'].imagen, 'https://ejemplo.invalid/masiva-000/1.webp');
});

// Anota qué textos entrega la base, para ver cuánto se lee además de lo que
// se responde.
function contarLecturas(base) {
  const leidas = [];
  const original = base.from.bind(base);
  base.from = tabla => {
    const q = original(tabla);
    if (tabla === 'prompt_bodies') {
      const then = q.then;
      q.then = (ok, mal) => then.call(q, r => { leidas.push(...(r.data || [])); return r; }).then(ok, mal);
    }
    return q;
  };
  return { leidas, restaurar: () => { base.from = original; } };
}

// Sin plan alcanzan las gratis: la base no debe entregar las demás para
// descartarlas acá. Antes cada pedido anónimo leía todas las v1, y repetirlo
// desde un script gastaba la transferencia mensual de Supabase.
for (const token of [null, 'gratis', 'inventada']) {
  await probar('todas sin plan lee de la base sólo las gratis / ' + (token || 'visitante'), async () => {
    const { leidas, restaurar } = contarLecturas(db);
    try {
      const r = await pedir(prompts, token, { todas: '1' });
      assert.deepEqual(Object.keys(r.cuerpo.prompts), [GRATIS[0]]);
    } finally { restaurar(); }
    assert.deepEqual(leidas.map(f => f.cat_id), [GRATIS[0]]);
  });
}

await probar('todas con muchas escenas permitidas sigue entregando todas', async () => {
  const grande = base(), p = cargarHandler('prompt', grande);
  for (let i = 0; i < 120; i++) {
    const id = 'masiva-' + String(i).padStart(3, '0');
    grande.tablas.categories.push({ id, tier: 'casual', status: 'publicada', ready: true, sort_order: 10 + i });
    grande.tablas.prompt_bodies.push({ cat_id: id, variant: 'prompt', body: 'MARCADOR-SINTETICO-' + id + '-prompt' });
  }
  assert.equal(Object.keys((await pedir(p, 'full', { todas: '1' })).cuerpo.prompts).length, 124);
  assert.equal(Object.keys((await pedir(p, 'admin', { todas: '1' })).cuerpo.prompts).length, 126);
  const anonimo = contarLecturas(grande);
  try {
    assert.deepEqual(Object.keys((await pedir(p, null, { todas: '1' })).cuerpo.prompts), [GRATIS[0]]);
  } finally { anonimo.restaurar(); }
  assert.equal(anonimo.leidas.length, 1, 'Sin plan se leyeron ' + anonimo.leidas.length + ' textos');
});

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

// verify revalida contra Patreon recién al cargar la página. Con la pestaña
// abierta más de 6 h, los pedidos siguientes no pueden tratar como free a
// quien paga: el plan comprobado vale hasta VALIDEZ_TIER_MS (72 h).
await probar('un plan comprobado hace 7 h abre prompt, foto y todas; a las 73 h ya no', async () => {
  const viejo = base(), p = cargarHandler('prompt', viejo), f = cargarHandler('ejemplos', viejo);
  const full = viejo.tablas.users.find(u => u.id === 'full');
  full.tier_checked_at = new Date(Date.now() - 7 * 3600000).toISOString();
  assert.equal((await pedir(p, 'full', { id: 'intimo-auditoria' })).codigo, 200);
  assert.equal((await pedir(f, 'full', { id: 'intimo-auditoria' })).codigo, 200);
  assert.ok(Object.keys((await pedir(p, 'full', { todas: '1' })).cuerpo.prompts).includes('intimo-auditoria'));
  full.tier_checked_at = new Date(Date.now() - 73 * 3600000).toISOString();
  assert.equal((await pedir(p, 'full', { id: 'intimo-auditoria' })).codigo, 403);
  assert.equal((await pedir(f, 'full', { id: 'intimo-auditoria' })).codigo, 403);
  assert.ok(!Object.keys((await pedir(p, 'full', { todas: '1' })).cuerpo.prompts).includes('intimo-auditoria'));
});

for (const [nombre, handler] of [['prompt', prompts], ['foto', fotos]]) {
  await probar(nombre + ' identifica peticiones inválidas y métodos no permitidos', async () => {
    for (const id of ['', 'x'.repeat(101), ['id']]) assert.equal((await pedir(handler, 'full', { id })).codigo, 400);
    assert.equal((await pedir(handler, 'admin', { id: 'ausente' })).codigo, 404);
    assert.equal((await pedir(handler, 'full', { id: GRATIS[0] }, 'POST')).codigo, 405);
    assert.equal((await pedir(handler, null, {}, 'OPTIONS')).codigo, 200);
  });
}

await probar('la miniatura subida reemplaza a la original sólo en miniaturas', async () => {
  const ruta = db.tablas.category_examples.find(e => e.cat_id === GRATIS[0]).ruta;
  db.archivos.add(rutaMiniatura(ruta));
  const r = await pedir(fotos, null, { id: GRATIS[0] });
  assert.deepEqual(r.cuerpo.imagenes, ['https://ejemplo.invalid/' + ruta]);
  assert.deepEqual(r.cuerpo.miniaturas, ['https://ejemplo.invalid/' + rutaMiniatura(ruta)]);
  assert.equal(db.firmas.at(-1).rutas.length, 2, 'Originales y miniaturas van en una sola firma');
  db.archivos.delete(rutaMiniatura(ruta));
});
await probar('el rechazo por plan no firma miniaturas', async () => {
  const firmas = db.firmas.length;
  const r = await pedir(fotos, 'gratis', { id: 'intimo-auditoria' });
  assert.equal(r.codigo, 403);
  assert.equal(r.cuerpo.miniaturas, undefined);
  assert.equal(db.firmas.length, firmas);
});
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
