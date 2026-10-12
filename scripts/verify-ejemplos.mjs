#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { applyCors } from '../api/_cors.js';

// Se ejecuta el handler real con filas y archivos sintéticos para reproducir
// el rechazo de Storage sin usar credenciales ni escribir en producción.
const fuente = readFileSync(new URL('../api/admin/ejemplos.js', import.meta.url), 'utf8');
const conTilde = 'corazon-nude-poses-intención';
const sinTilde = 'corazon-nude-poses-intencion';
const jpeg = 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 217]).toString('base64');

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
      };
    } },
  };
  const contexto = vm.createContext({
    process: { env: {} }, Buffer, applyCors,
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
for (const method of ['GET', 'POST', 'DELETE']) {
  const res = await bloqueada.llamar(method, { query: { id: conTilde, ruta: rutaConTilde }, body: { id: conTilde, archivo: jpeg, tipo: 'image/jpeg', tier: 'full', is_admin: true } });
  assert.equal(res.codigo, 403);
}
assert.equal(bloqueada.llamadas.tablas, 0);
assert.equal(bloqueada.llamadas.subidas.length, 0);
assert.equal(bloqueada.llamadas.borradas.length, 0);
console.log('OK fallos sin archivos huérfanos ni borrados ajenos; el cliente no habilita administración');
