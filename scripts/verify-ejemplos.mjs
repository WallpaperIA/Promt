#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { applyCors } from '../api/_cors.js';
import { leerMiniatura, rutaMiniatura, coincideConTipo } from '../api/_miniaturas.js';

// Se ejecuta el handler real con filas y archivos sintéticos para reproducir
// el rechazo de Storage sin usar credenciales ni escribir en producción.
const fuente = readFileSync(new URL('../api/admin/ejemplos.js', import.meta.url), 'utf8');
const conTilde = 'corazon-nude-poses-intención';
const sinTilde = 'corazon-nude-poses-intencion';
const jpeg = 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 217]).toString('base64');
// Cabecera RIFF/WEBP mínima: alcanza para la comprobación del servidor.
const webpBytes = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
const webp = 'data:image/webp;base64,' + webpBytes.toString('base64');

function entorno(opciones = {}) {
  const categorias = new Set([conTilde, sinTilde, 'mañana', 'manana', 'sentada-cama', 'utf8']);
  const filas = [...(opciones.filas || [])];
  const archivos = new Set(filas.map(f => f.ruta));
  // El peso de cada archivo en Storage (1000 bytes si no se indica).
  const tamanos = new Map(Object.entries(opciones.tamanos || {}));
  const llamadas = { subidas: [], borradas: [], actualizaciones: [], reemplazos: [], tablas: 0, listados: [] };
  function consulta(tabla) {
    llamadas.tablas++;
    let accion = 'select', campos = {}, cambios = {}, orden = null, rango = null;
    const coincide = fila => Object.entries(campos).every(([k, v]) => fila[k] === v);
    const resolver = () => {
      if (accion === 'update') {
        if (opciones.falloActualizacion) return { error: { message: 'fallo sintético' } };
        for (const fila of filas) if (coincide(fila)) Object.assign(fila, cambios);
        llamadas.actualizaciones.push({ campos: { ...campos }, cambios: { ...cambios } });
        return { error: null };
      }
      if (accion === 'delete') {
        for (let i = filas.length - 1; i >= 0; i--) if (coincide(filas[i])) filas.splice(i, 1);
        return { error: null };
      }
      if (opciones.falloLectura) return { data: null, error: { message: 'fallo sintético' } };
      let data = filas.filter(coincide).map(f => ({ ...f }));
      if (orden) data.sort((a, b) => (a[orden] - b[orden]));
      // Como PostgREST: nunca más de 1000 filas por pedido.
      data = rango ? data.slice(rango[0], Math.min(rango[1] + 1, rango[0] + 1000)) : data.slice(0, 1000);
      return { data, count: data.length, error: null };
    };
    const q = {
      select() { return q; },
      eq(k, v) { campos[k] = v; return q; },
      delete() { accion = 'delete'; return q; },
      update(datos) { accion = 'update'; cambios = datos; return q; },
      single: async () => ({ data: tabla === 'categories' && categorias.has(campos.id) ? { id: campos.id } : null, error: null }),
      maybeSingle: async () => opciones.falloConsulta ? { data: null, error: { message: 'fallo sintético' } } : { data: filas.find(coincide) || null, error: null },
      order(campo) { orden = campo; return q; },
      range(a, b) { rango = [a, b]; return q; },
      insert: async fila => {
        if (opciones.falloInsercion) return { error: { message: 'fallo sintético' } };
        filas.push({ ...fila });
        return { error: null };
      },
      then(ok, mal) { return Promise.resolve(resolver()).then(ok, mal); },
    };
    return q;
  }
  const supabase = {
    from: consulta,
    storage: { from(bucket) {
      assert.equal(bucket, 'ejemplos');
      return {
        async upload(ruta, bytes, config) {
          llamadas.subidas.push(ruta);
          if (ruta.endsWith('.mini.webp')) {
            // La miniatura se puede rehacer: pisa la anterior.
            assert.equal(config.upsert, true);
            assert.equal(config.contentType, 'image/webp');
            assert.equal(bytes.toString('latin1', 8, 12), 'WEBP');
            if (opciones.falloMiniatura) return { error: { message: 'fallo sintético' } };
            archivos.add(ruta);
            return { error: null };
          }
          if (config.upsert) {
            // Sólo «optimizar» pisa una original, y sólo una que ya existe.
            assert.ok(archivos.has(ruta), 'pisar sólo una original existente');
            assert.ok(coincideConTipo(bytes, config.contentType));
            llamadas.reemplazos.push([ruta, config.contentType, bytes.length]);
            return { error: null };
          }
          assert.equal(config.upsert, false);
          // A Storage sólo llegan bytes del tipo con que se rotulan.
          assert.ok(coincideConTipo(bytes, config.contentType));
          // La restricción pertenece al servidor de Storage, no al handler:
          // https://github.com/supabase/storage/blob/master/src/storage/limits.ts
          if (!/^[A-Za-z0-9_/!.*'() &$=@;:+,?-]+$/.test(ruta)) return { error: { message: 'InvalidKey' } };
          if (archivos.has(ruta)) return { error: { message: 'Ya existe' } };
          archivos.add(ruta);
          return { error: null };
        },
        async remove(rutas) {
          llamadas.borradas.push(...rutas);
          rutas.forEach(r => archivos.delete(r));
          return { error: null };
        },
        // Como Storage: los archivos de esa carpeta con su peso, y cada
        // subcarpeta una vez, sin metadata. Hasta 1000 por pedido.
        async list(carpeta, { limit = 100, offset = 0 } = {}) {
          llamadas.listados.push(carpeta);
          if (opciones.falloListado) return { data: null, error: { message: 'fallo sintético' } };
          const prefijo = carpeta ? carpeta + '/' : '', entradas = [], subcarpetas = new Set();
          for (const ruta of [...archivos].sort()) {
            if (!ruta.startsWith(prefijo)) continue;
            const [nombre, ...resto] = ruta.slice(prefijo.length).split('/');
            if (!resto.length) entradas.push({ name: nombre, id: 'id-' + ruta, metadata: { size: tamanos.get(ruta) ?? 1000 } });
            else if (!subcarpetas.has(nombre)) { subcarpetas.add(nombre); entradas.push({ name: nombre, id: null, metadata: null }); }
          }
          return { data: entradas.slice(offset, offset + Math.min(limit, 1000)), error: null };
        },
        async createSignedUrls(rutas, segundos) {
          llamadas.firmas = (llamadas.firmas || 0) + 1;
          llamadas.vigencias = [...(llamadas.vigencias || []), segundos];
          assert.ok(segundos <= 1800);
          return { data: rutas.map(r => ({ path: r, signedUrl: archivos.has(r) ? 'https://firma.invalid/' + r : null })), error: null };
        },
      };
    } },
  };
  const contexto = vm.createContext({
    process: { env: {} }, Buffer, applyCors, leerMiniatura, rutaMiniatura, coincideConTipo,
    console: { error() {} },
    createClient: () => supabase,
    exigirAdmin: async (_, req, res) => {
      if (opciones.admin !== false) return { id: 'admin-sintetico' };
      res.status(403).json({ error: 'admin_required' });
      return null;
    },
  });
  vm.runInContext(fuente.replace(/^import .*;\n/gm, '').replace('export default async function handler', 'async function handler'), contexto);
  async function llamar(method, datos = {}) {
    const res = {
      codigo: 200, cabeceras: {},
      setHeader(k, v) { this.cabeceras[k] = v; },
      status(c) { this.codigo = c; return this; },
      json(c) { this.cuerpo = JSON.parse(JSON.stringify(c)); return this; },
      end() { return this; },
    };
    await contexto.handler({ method, headers: {}, query: {}, ...datos }, res);
    return res;
  }
  return { llamar, filas, archivos, llamadas };
}

const e = entorno();
const subidas = new Map();
for (const id of [conTilde, sinTilde, 'mañana', 'manana']) {
  const res = await e.llamar('POST', { body: { id, archivo: jpeg, tipo: 'image/jpeg' } });
  assert.equal(res.codigo, 201, `Storage tiene que aceptar el ejemplo de ${id}`);
  assert.equal(res.cabeceras['Cache-Control'], 'private, no-store');
  assert.equal(e.filas.find(f => f.ruta === res.cuerpo.ruta).cat_id, id);
  subidas.set(id, res.cuerpo.ruta);
}
assert.equal(subidas.get(sinTilde).startsWith(sinTilde + '/'), true);
assert.equal(subidas.get('manana').startsWith('manana/'), true);
assert.notEqual(subidas.get(conTilde).split('/').slice(0, -1).join('/'), subidas.get(sinTilde).split('/').slice(0, -1).join('/'));
assert.notEqual(subidas.get('mañana').split('/').slice(0, -1).join('/'), subidas.get('manana').split('/').slice(0, -1).join('/'));
const listado = await e.llamar('GET', { query: { id: conTilde } });
assert.equal(listado.codigo, 200);
assert.equal(listado.cuerpo.imagenes.length, 1);
assert.equal(listado.cuerpo.imagenes[0].ruta, subidas.get(conTilde));
assert.equal(listado.cuerpo.imagenes[0].orden, 0);
console.log('OK subidas con tildes, IDs sin alterar, carpetas ASCII anteriores y listado de la galería');

// Elegir la portada conserva todos los archivos y las demás posiciones.
const galeria = entorno({ filas: [
  { cat_id: 'sentada-cama', ruta: 'sentada-cama/primera.jpg', orden: 0 },
  { cat_id: 'sentada-cama', ruta: 'sentada-cama/segunda.jpg', orden: 1 },
  { cat_id: 'sentada-cama', ruta: 'sentada-cama/tercera.jpg', orden: 2 },
  { cat_id: 'manana', ruta: 'manana/ajena.jpg', orden: 0 },
] });
const elegir = (ruta, id = 'sentada-cama') => galeria.llamar('PUT', { body: { id, ruta, accion: 'principal' } });
assert.equal((await elegir('sentada-cama/segunda.jpg')).codigo, 200);
assert.deepEqual(galeria.filas.map(f => f.orden), [0, -1, 2, 0]);
assert.equal((await galeria.llamar('GET', { query: { id: 'sentada-cama' } })).cuerpo.imagenes[0].ruta, 'sentada-cama/segunda.jpg');
assert.equal((await elegir('sentada-cama/segunda.jpg')).codigo, 200);
assert.equal(galeria.llamadas.actualizaciones.length, 1, 'Volver a elegir la misma es idempotente');
assert.equal((await elegir('sentada-cama/primera.jpg')).codigo, 200);
assert.equal((await galeria.llamar('GET', { query: { id: 'sentada-cama' } })).cuerpo.imagenes[0].ruta, 'sentada-cama/primera.jpg');
assert.equal((await elegir('manana/ajena.jpg')).codigo, 400);
assert.equal((await elegir('sentada-cama/inventada.jpg')).codigo, 400);
assert.equal(galeria.archivos.size, 4);
assert.equal(galeria.llamadas.subidas.length, 0);
assert.equal(galeria.llamadas.borradas.length, 0);
const sinPermiso = entorno({ admin: false });
assert.equal((await sinPermiso.llamar('PUT', { body: { id: 'sentada-cama', ruta: 'sentada-cama/primera.jpg', accion: 'principal' } })).codigo, 403);
assert.equal(sinPermiso.llamadas.tablas, 0);
const noLee = entorno({ falloLectura: true });
assert.equal((await noLee.llamar('PUT', { body: { id: 'sentada-cama', ruta: 'sentada-cama/primera.jpg', accion: 'principal' } })).codigo, 500);
assert.equal(noLee.llamadas.actualizaciones.length, 0);
const noGuarda = entorno({ falloActualizacion: true, filas: [
  { cat_id: 'sentada-cama', ruta: 'sentada-cama/primera.jpg', orden: 0 },
  { cat_id: 'sentada-cama', ruta: 'sentada-cama/segunda.jpg', orden: 1 },
] });
assert.equal((await noGuarda.llamar('PUT', { body: { id: 'sentada-cama', ruta: 'sentada-cama/segunda.jpg', accion: 'principal' } })).codigo, 500);
assert.deepEqual(noGuarda.filas.map(f => f.orden), [0, 1]);
assert.equal(noGuarda.archivos.size, 2);
console.log('OK portada reversible: permisos, rutas vinculadas, orden, idempotencia y fallos sin borrar fotos');

const rutaConTilde = subidas.get(conTilde);
const ajena = await e.llamar('DELETE', { query: { id: sinTilde, ruta: rutaConTilde } });
assert.equal(ajena.codigo, 400);
assert.equal(e.llamadas.borradas.length, 0);
assert.equal(e.archivos.has(rutaConTilde), true);
const prefijo = await e.llamar('DELETE', { query: { id: 'utf8', ruta: rutaConTilde } });
assert.equal(prefijo.codigo, 400);
assert.equal(e.llamadas.borradas.length, 0);
const propia = await e.llamar('DELETE', { query: { id: conTilde, ruta: rutaConTilde } });
assert.equal(propia.codigo, 200);
assert.equal(e.archivos.has(rutaConTilde), false);
assert.equal(e.filas.some(f => f.cat_id === conTilde), false);
const anterior = entorno({ filas: [{ cat_id: 'sentada-cama', ruta: 'sentada-cama/anterior.jpg', orden: 0 }] });
assert.equal((await anterior.llamar('DELETE', { query: { id: 'sentada-cama', ruta: 'sentada-cama/anterior.jpg' } })).codigo, 200);
console.log('OK se pueden quitar ejemplos nuevos y anteriores; una ruta ajena no borra archivos');

const falla = entorno({ falloInsercion: true });
assert.equal((await falla.llamar('POST', { body: { id: conTilde, archivo: jpeg, tipo: 'image/jpeg' } })).codigo, 500);
assert.equal(falla.archivos.size, 0);
assert.equal(falla.filas.length, 0);
assert.equal(falla.llamadas.borradas.length, 1);
const consultaFallida = entorno({ falloConsulta: true, filas: [{ cat_id: conTilde, ruta: rutaConTilde, orden: 0 }] });
assert.equal((await consultaFallida.llamar('DELETE', { query: { id: conTilde, ruta: rutaConTilde } })).codigo, 500);
assert.equal(consultaFallida.llamadas.borradas.length, 0);
assert.equal(consultaFallida.archivos.has(rutaConTilde), true);
const bloqueada = entorno({ admin: false });
for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
  const res = await bloqueada.llamar(method, { query: { id: conTilde, ruta: rutaConTilde }, body: { id: conTilde, archivo: jpeg, tipo: 'image/jpeg', tier: 'full', is_admin: true } });
  assert.equal(res.codigo, 403);
}
assert.equal(bloqueada.llamadas.tablas, 0);
assert.equal(bloqueada.llamadas.subidas.length, 0);
assert.equal(bloqueada.llamadas.borradas.length, 0);
console.log('OK fallos sin archivos huérfanos ni borrados ajenos; el cliente no habilita administración');

// Miniaturas: se suben junto con la foto o después, siempre derivadas de una
// fila de esa categoría, y se van con la foto al quitarla.
const m = entorno();
const conMini = await m.llamar('POST', { body: { id: sinTilde, archivo: jpeg, tipo: 'image/jpeg', miniatura: webp } });
assert.equal(conMini.codigo, 201);
assert.equal(conMini.cuerpo.miniatura, true);
assert.equal(m.archivos.has(rutaMiniatura(conMini.cuerpo.ruta)), true);
const malaMini = await m.llamar('POST', { body: { id: sinTilde, archivo: jpeg, tipo: 'image/jpeg', miniatura: jpeg } });
assert.equal(malaMini.codigo, 400);
assert.equal(malaMini.cuerpo.error, 'miniatura_no_webp');
assert.equal(m.filas.length, 1, 'Una miniatura inválida no deja la foto a medias');
const grande = 'data:image/webp;base64,' + Buffer.concat([webpBytes, Buffer.alloc(200 * 1024)]).toString('base64');
assert.equal((await m.llamar('POST', { body: { id: sinTilde, archivo: jpeg, tipo: 'image/jpeg', miniatura: grande } })).codigo, 400);
const sinMini = await m.llamar('POST', { body: { id: 'manana', archivo: jpeg, tipo: 'image/jpeg' } });
assert.equal(sinMini.codigo, 201);
assert.equal(sinMini.cuerpo.miniatura, false);
const firmado = await m.llamar('GET', { query: { id: 'manana', firmar: '1' } });
assert.equal(firmado.cuerpo.imagenes[0].mini, false);
assert.ok(firmado.cuerpo.imagenes[0].url.endsWith(sinMini.cuerpo.ruta));
const subidasAntes = m.llamadas.subidas.length;
const ajenaMini = await m.llamar('PUT', { body: { id: sinTilde, ruta: sinMini.cuerpo.ruta, miniatura: webp } });
assert.equal(ajenaMini.codigo, 400, 'La ruta de otra categoría no se puede usar para escribir');
const inventada = await m.llamar('PUT', { body: { id: 'manana', ruta: 'manana/../otra.jpg', miniatura: webp } });
assert.equal(inventada.codigo, 400);
assert.equal((await m.llamar('PUT', { body: { id: 'manana', ruta: sinMini.cuerpo.ruta, miniatura: jpeg } })).codigo, 400);
assert.equal(m.llamadas.subidas.length, subidasAntes);
const relleno = await m.llamar('PUT', { body: { id: 'manana', ruta: sinMini.cuerpo.ruta, miniatura: webp } });
assert.equal(relleno.codigo, 200);
assert.equal(m.archivos.has(rutaMiniatura(sinMini.cuerpo.ruta)), true);
assert.equal((await m.llamar('GET', { query: { id: 'manana', firmar: '1' } })).cuerpo.imagenes[0].mini, true);
assert.equal((await m.llamar('PUT', { body: { id: 'manana', ruta: sinMini.cuerpo.ruta, miniatura: webp } })).codigo, 200, 'Rehacerla pisa la anterior');
const quitada = await m.llamar('DELETE', { query: { id: 'manana', ruta: sinMini.cuerpo.ruta } });
assert.equal(quitada.codigo, 200);
assert.equal(m.archivos.has(rutaMiniatura(sinMini.cuerpo.ruta)), false);
assert.equal(m.archivos.has(sinMini.cuerpo.ruta), false);
const fallaMini = entorno({ falloMiniatura: true });
const fm = await fallaMini.llamar('POST', { body: { id: sinTilde, archivo: jpeg, tipo: 'image/jpeg', miniatura: webp } });
assert.equal(fm.codigo, 201, 'Si sólo falla la miniatura, la foto queda');
assert.equal(fm.cuerpo.miniatura, false);
assert.equal(fallaMini.filas.length, 1);
console.log('OK miniaturas: al subir, rellenar las anteriores, sólo WebP chicas, rutas de la categoría y borrado conjunto');

// El tipo lo declara el navegador: los bytes tienen que coincidir. Sin esto,
// una sesión de admin robada podía subir un HTML o un SVG rotulado como foto.
const disfraz = entorno();
const html = 'data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]).toString('base64');
for (const [archivo, tipo] of [[html, 'image/png'], [html, 'image/jpeg'], [html, 'image/webp'], [png, 'image/jpeg'], [jpeg, 'image/webp']]) {
  const r = await disfraz.llamar('POST', { body: { id: sinTilde, archivo, tipo } });
  assert.equal(r.codigo, 400, `${tipo} con otros bytes se rechaza`);
  assert.equal(r.cuerpo.error, 'archivo_no_es_imagen');
}
assert.equal(disfraz.archivos.size, 0, 'Un archivo rechazado no llega a Storage');
assert.equal(disfraz.filas.length, 0);
for (const [archivo, tipo] of [[png, 'image/png'], [webp, 'image/webp'], [jpeg, 'image/jpeg']]) {
  assert.equal((await disfraz.llamar('POST', { body: { id: sinTilde, archivo, tipo } })).codigo, 201, `${tipo} real se acepta`);
}
console.log('OK subida: sólo se aceptan bytes de JPEG, PNG o WebP que coinciden con el tipo declarado');

// Optimizar (lo usa la revisión automática del panel): reemplaza la
// original en su misma ruta, con el tipo de su extensión y sólo si es una
// foto de esa categoría. La fila, el orden y la miniatura no cambian.
const o = entorno();
const fotoJpg = await o.llamar('POST', { body: { id: 'manana', archivo: jpeg, tipo: 'image/jpeg', miniatura: webp } });
const fotoWebp = await o.llamar('POST', { body: { id: 'manana', archivo: webp, tipo: 'image/webp' } });
const optimizar = (ruta, archivo, id = 'manana') => o.llamar('PUT', { body: { id, ruta, accion: 'optimizar', archivo } });
const optimizada = await optimizar(fotoJpg.cuerpo.ruta, jpeg);
assert.equal(optimizada.codigo, 200);
assert.deepEqual(o.llamadas.reemplazos.at(-1), [fotoJpg.cuerpo.ruta, 'image/jpeg', 4]);
assert.equal(o.filas.length, 2, 'No agrega ni quita filas');
assert.ok(o.archivos.has(rutaMiniatura(fotoJpg.cuerpo.ruta)), 'La miniatura sigue');
assert.equal((await optimizar(fotoWebp.cuerpo.ruta, webp)).codigo, 200);
assert.equal(o.llamadas.reemplazos.at(-1)[1], 'image/webp');
assert.equal((await optimizar(fotoJpg.cuerpo.ruta, webp)).cuerpo.error, 'archivo_no_es_imagen', 'Otro formato bajo el mismo nombre');
assert.equal((await optimizar(fotoWebp.cuerpo.ruta, jpeg)).cuerpo.error, 'archivo_no_es_imagen');
assert.equal((await optimizar(fotoJpg.cuerpo.ruta, jpeg, sinTilde)).cuerpo.error, 'ruta_ajena', 'La foto de otra categoría no se puede pisar');
assert.equal((await optimizar('manana/../otra.jpg', jpeg)).cuerpo.error, 'ruta_ajena');
assert.equal((await optimizar('manana/x.gif', jpeg)).cuerpo.error, 'tipo_no_permitido');
assert.equal((await optimizar(fotoJpg.cuerpo.ruta, '')).cuerpo.error, 'archivo_vacio');
const enorme = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(3 * 1024 * 1024)]).toString('base64');
assert.equal((await optimizar(fotoJpg.cuerpo.ruta, enorme)).codigo, 413);
assert.equal(o.llamadas.reemplazos.length, 2, 'Los pedidos rechazados no tocan Storage');
const sinAdmin = entorno({ admin: false, filas: [{ cat_id: 'manana', ruta: 'manana/a.jpg', orden: 0 }] });
assert.equal((await sinAdmin.llamar('PUT', { body: { id: 'manana', ruta: 'manana/a.jpg', accion: 'optimizar', archivo: jpeg } })).codigo, 403);
assert.equal(sinAdmin.llamadas.reemplazos.length, 0);
console.log('OK optimizar: misma ruta y tipo de su extensión, sólo fotos de la categoría, sin tocar filas ni miniatura');

// Revisión automática del panel: el servidor dice qué fotos pesan más de
// 400 KB o no tienen miniatura, con su peso en Storage y la URL de la
// original, en un solo pedido. Las demás no se bajan.
const KB = 1024;
const acentuada = 'utf8/' + Buffer.from('mañana', 'utf8').toString('hex') + '/acentuada.png';
const rev = entorno({
  filas: [
    { cat_id: 'manana', ruta: 'manana/grande.jpg', orden: 0 },
    { cat_id: 'manana', ruta: 'manana/chica.jpg', orden: 1 },
    { cat_id: 'manana', ruta: 'manana/sin-mini.jpg', orden: 2 },
    { cat_id: 'utf8', ruta: 'utf8/propia.webp', orden: 0 },
    { cat_id: 'mañana', ruta: acentuada, orden: 0 },
    { cat_id: 'sentada-cama', ruta: 'sentada-cama/perdida.jpg', orden: 0 },
  ],
  tamanos: { 'manana/grande.jpg': 900 * KB, 'manana/chica.jpg': 90 * KB, 'manana/sin-mini.jpg': 90 * KB,
    'utf8/propia.webp': 500 * KB, [acentuada]: 400 * KB + 1 },
});
rev.archivos.delete('sentada-cama/perdida.jpg');
for (const ruta of ['manana/grande.jpg', 'manana/chica.jpg', 'utf8/propia.webp', acentuada]) rev.archivos.add(rutaMiniatura(ruta));
const revision = await rev.llamar('GET', { query: { todas: '1' } });
assert.equal(revision.codigo, 200);
assert.equal(revision.cabeceras['Cache-Control'], 'private, no-store');
assert.equal(revision.cuerpo.total, 6);
assert.deepEqual(revision.cuerpo.fotos.sort((a, b) => a.ruta < b.ruta ? -1 : 1), [
  { id: 'manana', ruta: 'manana/grande.jpg', bytes: 900 * KB, mini: true, pesada: true, url: 'https://firma.invalid/manana/grande.jpg' },
  { id: 'manana', ruta: 'manana/sin-mini.jpg', bytes: 90 * KB, mini: false, pesada: false, url: 'https://firma.invalid/manana/sin-mini.jpg' },
  { id: 'mañana', ruta: acentuada, bytes: 400 * KB + 1, mini: true, pesada: true, url: 'https://firma.invalid/' + acentuada },
  { id: 'utf8', ruta: 'utf8/propia.webp', bytes: 500 * KB, mini: true, pesada: true, url: 'https://firma.invalid/utf8/propia.webp' },
]);
assert.deepEqual([...rev.llamadas.listados].sort(), ['manana', 'sentada-cama', 'utf8', acentuada.slice(0, acentuada.lastIndexOf('/'))].sort(),
  'Cada carpeta se lista una vez; la subcarpeta utf8/<hex> no se mezcla con la escena «utf8»');
assert.equal(rev.llamadas.firmas, 1, 'Una sola firma para las pendientes');
assert.deepEqual(rev.llamadas.vigencias, [1800]);
assert.equal(rev.llamadas.subidas.length + rev.llamadas.borradas.length + rev.llamadas.reemplazos.length, 0, 'Mirar no escribe nada');

const revSinAdmin = entorno({ admin: false, filas: [{ cat_id: 'manana', ruta: 'manana/a.jpg', orden: 0 }] });
assert.equal((await revSinAdmin.llamar('GET', { query: { todas: '1' } })).codigo, 403);
assert.equal(revSinAdmin.llamadas.tablas + revSinAdmin.llamadas.listados.length, 0);
const revFalla = entorno({ falloListado: true, filas: [{ cat_id: 'manana', ruta: 'manana/a.jpg', orden: 0 }] });
const fallida = await revFalla.llamar('GET', { query: { todas: '1' } });
assert.equal(fallida.codigo, 500);
assert.equal(fallida.cuerpo.fotos, undefined);

// Más de 1000 filas y una carpeta con más de 1000 archivos: se leen por páginas.
const muchas = [];
const pesos = {};
for (let i = 0; i < 1001; i++) muchas.push({ cat_id: 'escena-' + (i % 30), ruta: 'escena-' + (i % 30) + '/f' + i + '.jpg', orden: i });
for (let i = 0; i < 1001; i++) muchas.push({ cat_id: 'carpeta-llena', ruta: 'carpeta-llena/f' + String(i).padStart(4, '0') + '.jpg', orden: i });
pesos['escena-7/f7.jpg'] = 700 * KB;
pesos['carpeta-llena/f1000.jpg'] = 2000 * KB;
const paginas = entorno({ filas: muchas, tamanos: pesos });
for (const f of muchas) if (f.ruta !== 'escena-3/f3.jpg') paginas.archivos.add(rutaMiniatura(f.ruta));
const todasPaginas = await paginas.llamar('GET', { query: { todas: '1' } });
assert.equal(todasPaginas.codigo, 200);
assert.equal(todasPaginas.cuerpo.total, 2002);
assert.deepEqual(todasPaginas.cuerpo.fotos.map(f => f.ruta).sort(), ['carpeta-llena/f1000.jpg', 'escena-3/f3.jpg', 'escena-7/f7.jpg']);
assert.equal(paginas.llamadas.listados.filter(c => c === 'carpeta-llena').length, 3, '2002 archivos en páginas de 1000');
assert.equal(new Set(paginas.llamadas.listados).size, 31);
assert.equal(paginas.llamadas.listados.length, 33);
console.log('OK revisión automática: sólo las pesadas o sin miniatura, peso de Storage, carpetas con tildes, páginas y sólo admin');

