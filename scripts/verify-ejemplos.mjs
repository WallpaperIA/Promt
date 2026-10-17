#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { applyCors } from '../api/_cors.js';
import { leerMiniatura, rutaMiniatura } from '../api/_miniaturas.js';

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
  const llamadas = { subidas: [], borradas: [], tablas: 0 };
  function consulta(tabla) {
    llamadas.tablas++;
    let accion = 'select', campos = {};
    const coincide = fila => Object.entries(campos).every(([k, v]) => fila[k] === v);
    const resolver = () => {
      if (accion === 'delete') {
        for (let i = filas.length - 1; i >= 0; i--) if (coincide(filas[i])) filas.splice(i, 1);
        return { error: null };
      }
      const data = filas.filter(coincide).map(f => ({ ...f }));
      return { data, count: data.length, error: null };
    };
    const q = {
      select() { return q; },
      eq(k, v) { campos[k] = v; return q; },
      delete() { accion = 'delete'; return q; },
      single: async () => ({ data: tabla === 'categories' && categorias.has(campos.id) ? { id: campos.id } : null, error: null }),
      maybeSingle: async () => opciones.falloConsulta ? { data: null, error: { message: 'fallo sintético' } } : { data: filas.find(coincide) || null, error: null },
      order: async () => resolver(),
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
          assert.equal(config.upsert, false);
          assert.equal(bytes.length, 4);
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
        async createSignedUrls(rutas, segundos) {
          llamadas.firmas = (llamadas.firmas || 0) + 1;
          assert.ok(segundos <= 1800);
          return { data: rutas.map(r => ({ path: r, signedUrl: archivos.has(r) ? 'https://firma.invalid/' + r : null })), error: null };
        },
      };
    } },
  };
  const contexto = vm.createContext({
    process: { env: {} }, Buffer, applyCors, leerMiniatura, rutaMiniatura,
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
