#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearAlmacenCreacion, validarDatoCreacion, validarCombinacion, sorprender, normalizarCombinacion, resolverPersonas, versionesColeccion, escenasNuevas, CANDADOS_INICIALES } from '../assets/creacion-datos.js';
import { validarAjustes, combinarAjustes } from '../assets/ajustes-datos.js';

const copia = x => structuredClone(x), json = JSON.stringify;
const s = { name: 'Trío editorial', catId: 'estudio', mode: 'trio', style: 'playboy', outfit: 'none', hair: 'none', format: '16-9', details: ['luz-a', 'labios-a'],
  people: [{ outfit: 'a' }, { hair: 'b' }, { details: [] }], characters: ['Ána $&', 'Bea', 'Cata'] };
const opciones = ids => ids.map(id => ({ id, name: id, tier: 'free' }));
const catalogos = { styles: [...opciones(['playboy', 'foto']), { id: 'vip', tier: 'full' }], outfits: [...opciones(['none', 'a', 'b', 'c']), { id: 'vip', tier: 'full' }],
  hairs: opciones(['none', 'a', 'b', 'c']), formats: opciones(['16-9', '1-1']), personal: id => id.startsWith('labios'),
  details: [{ id: 'luz-a', group: 'Luz', excl: 'luz' }, { id: 'luz-b', group: 'Luz', excl: 'luz' }, { id: 'labios-a', group: 'Maquillaje', excl: 'labios' }, { id: 'labios-b', group: 'Maquillaje', excl: 'labios' }] };
let casos = 0;
function prueba(nombre, fn) { fn(); casos++; console.log('OK ' + nombre); }
prueba('se guardan controles y nombres explícitos; cuerpos, permisos y campos desconocidos se rechazan', () => {
  assert.equal(validarCombinacion(s), true);
  for (const campo of ['body', 'token', 'esAdmin', 'url', 'tier']) assert.equal(validarCombinacion({ ...s, [campo]: 'no' }), false);
  assert.equal(validarCombinacion({ ...s, characters: ['a'] }), false);
  assert.equal(validarCombinacion({ ...s, people: [{ outfit: 'a' }, {}, { details: ['a'], body: 'no' }] }), false);
  assert.equal(validarAjustes({ wp_combinations_v1: json({ abc: s }) }), true);
  assert.equal(validarAjustes({ wp_combinations_v1: '{"__proto__":{}}' }), false);
  assert.equal(validarDatoCreacion('wp_combinations_v1', Object.fromEntries(Array.from({ length: 81 }, (_, i) => ['c' + i, s]))), false);
  assert.equal(validarDatoCreacion('wp_random_locks_v1', { style: 'true' }), false);
});
prueba('todos los candados conservan exactamente cada control y el original no se muta', () => {
  const antes = copia(s), todos = Object.fromEntries(Object.keys(CANDADOS_INICIALES).map(k => [k, true]));
  assert.deepEqual(sorprender(s, todos, catalogos), s); assert.deepEqual(s, antes);
});
prueba('Sorpréndeme conserva nombres y formato por defecto y cambia sólo opciones disponibles', () => {
  const r = sorprender(s, {}, catalogos, t => t !== 'full', [], () => 0.25);
  assert.deepEqual(r.characters, s.characters); assert.equal(r.format, '16-9'); assert.equal(r.mode, 'trio'); assert.equal(r.catId, 'estudio');
  assert.notEqual(r.style, s.style); assert.notEqual(r.style, 'vip');
  assert.equal(new Set(r.people.map(p => p.outfit)).size, 3); assert.equal(new Set(r.people.map(p => p.hair)).size, 3);
  assert.ok(r.people.every(p => p.outfit !== 'vip'));
});
prueba('los sorteos respetan alcance y exclusividad de extras', () => {
  for (let i = 0; i < 40; i++) {
    let semilla = i + 1; const azar = () => ((semilla = (semilla * 16807) % 2147483647) - 1) / 2147483646;
    const r = sorprender(s, {}, catalogos, () => true, [], azar);
    assert.ok(r.details.every(id => !catalogos.personal(id))); assert.ok(r.details.length <= 1);
    assert.ok(r.people.every(p => p.details.every(catalogos.personal) && p.details.length <= 1));
    assert.equal(new Set(r.people.map(p => p.outfit)).size, 3); assert.equal(new Set(r.people.map(p => p.hair)).size, 3);
  }
});
prueba('candados individuales conservan también las excepciones por participante', () => {
  const r = sorprender(s, { outfit: true, hair: true, details: true }, catalogos);
  for (const k of ['outfit', 'hair', 'details', 'people']) assert.deepEqual(r[k], s[k]);
});
prueba('personajes sorteados no se duplican y un catálogo insuficiente conserva los nombres', () => {
  const r = sorprender(s, { characters: false }, catalogos, () => true, ['Ána $&', 'Bea', 'Cata', 'Cata'], () => 0);
  assert.equal(new Set(r.characters).size, 3);
  assert.deepEqual(sorprender(s, { characters: false }, catalogos, () => true, ['Uno']).characters, s.characters);
});
prueba('opciones retiradas o de otro plan vuelven a originales sin cambiar el catálogo', () => {
  const r = normalizarCombinacion({ ...s, style: 'vip', hair: 'retirado', people: [{ outfit: 'vip' }, {}, { details: ['luz-a', 'labios-a', 'retirado'] }] }, catalogos, t => t !== 'full');
  assert.equal(r.estado.style, 'playboy'); assert.equal(r.estado.hair, 'none'); assert.equal(r.estado.people[0].outfit, 'none');
  assert.deepEqual(r.estado.people[2].details, ['labios-a']); assert.equal(r.omitidos.length, 3); assert.equal(catalogos.styles[2].tier, 'full');
});
prueba('el resumen resuelve herencia y respeta una lista vacía de extras personales', () => {
  const p = resolverPersonas(s, catalogos.personal);
  assert.equal(p[0].outfit, 'a'); assert.equal(p[0].hair, 'none'); assert.deepEqual(p[0].details, ['labios-a']);
  assert.equal(p[1].hair, 'b'); assert.deepEqual(p[2].details, []); assert.equal(p[0].name, 'Ána $&');
});
prueba('combinaciones distintas de dos dispositivos se conservan en una fusión', () => {
  const r = combinarAjustes({}, { wp_combinations_v1: json({ aaa: s }) }, { wp_combinations_v1: json({ bbb: { ...s, name: 'Otra' } }) });
  assert.deepEqual(Object.keys(JSON.parse(r.datos.wp_combinations_v1)).sort(), ['aaa', 'bbb']); assert.deepEqual(r.conflictos, []);
});
prueba('colecciones combinan cambios de carpetas y de versiones sin perder ninguno', () => {
  const base = { folders: { aaa: { name: 'Estudio' } }, versions: {} }, local = copia(base), remoto = copia(base);
  local.folders.bbb = { name: 'Playa' }; remoto.versions['version-1'] = 'aaa';
  const r = combinarAjustes({ wp_collections_v1: json(base) }, { wp_collections_v1: json(local) }, { wp_collections_v1: json(remoto) });
  const d = JSON.parse(r.datos.wp_collections_v1); assert.equal(d.folders.bbb.name, 'Playa'); assert.equal(d.versions['version-1'], 'aaa'); assert.deepEqual(r.conflictos, []);
});
prueba('borrar una carpeta conserva sus versiones y las devuelve en Sin colección', () => {
  const lista = [{ id: 'a' }, { id: 'b' }], d = { folders: { carpeta: { name: 'Playa' } }, versions: { a: 'carpeta' } };
  assert.deepEqual(versionesColeccion(lista, d, 'carpeta'), [{ id: 'a' }]); delete d.folders.carpeta;
  assert.deepEqual(versionesColeccion(lista, d, 'unfiled'), lista); assert.equal(lista.length, 2);
});
prueba('sin espacio o JSON dañado, el almacenamiento falla sin borrar datos previos', () => {
  const datos = new Map([['wp_combinations_v1', '{roto']]);
  const store = crearAlmacenCreacion({ getItem: k => datos.get(k) ?? null, setItem() { throw Error('quota'); } });
  assert.deepEqual(store.leer('wp_combinations_v1', {}), {}); assert.equal(store.guardar('wp_combinations_v1', { abc: s }), false); assert.equal(datos.get('wp_combinations_v1'), '{roto');
});
prueba('novedades detecta altas y omite borradores', () => {
  assert.deepEqual(escenasNuevas([{ id: 'vieja' }, { id: 'nueva' }, { id: 'borrador', ready: false }], { vieja: true }).map(x => x.id), ['nueva']);
});
prueba('el módulo publicado se resuelve desde el documento y está en la lista del build', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8'), build = readFileSync(new URL('./build-site.mjs', import.meta.url), 'utf8');
  assert.ok(html.includes("new URL('assets/creacion.js', document.baseURI).href"));
  for (const p of ['assets/creacion.js', 'assets/creacion-datos.js', 'assets/creacion.css']) assert.ok(build.includes(p));
});
console.log(casos + ' verificaciones de creación completas.');
