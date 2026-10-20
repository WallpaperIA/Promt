#!/usr/bin/env node
// Ejecuta assets/migrar-ajustes.js en un navegador simulado: ventana de la
// cuenta, ventana emergente del enlace público y almacenamiento local. Los
// datos son sintéticos; no hay nombres de personas reales ni prompts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fuente = readFileSync(new URL('../assets/migrar-ajustes.js', import.meta.url), 'utf8');
const CUENTA = 'https://promt-iota.vercel.app', PUBLICO = 'https://wallpaperia.github.io';

function almacen(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), _m: m };
}
function elemento() {
  const e = { hidden: true, textContent: '', oyentes: {}, hijos: [],
    addEventListener(t, f) { this.oyentes[t] = f; }, click() { this.oyentes.click?.(); },
    appendChild(h) { this.hijos.push(h); return h; } };
  return e;
}
function cuenta({ local = {}, sesion = {}, bloquearVentana = false } = {}) {
  const oyentes = [], aviso = elemento(), parrafo = elemento(), traer = elemento(), cerrar = elemento(), grupo = elemento();
  aviso.querySelector = sel => ({ p: parrafo, '[data-traer-ajustes]': traer, '[data-cerrar-aviso-ajustes]': cerrar })[sel];
  const emergente = { mensajes: [], cerrada: false, postMessage(d, o) { this.mensajes.push({ d, o }); }, close() { this.cerrada = true; } };
  const ctx = {
    location: { origin: CUENTA, pathname: '/', recargas: 0, reload() { this.recargas++; } },
    localStorage: almacen(local), sessionStorage: almacen(sesion),
    crypto: { randomUUID: () => 'nonce-sintetico' },
    document: { getElementById: id => (id === 'aviso-ajustes' ? aviso : null),
      querySelector: sel => (sel === '#settings-panel .settings-group:last-child' ? grupo : null),
      createElement: () => elemento() },
    addEventListener: (t, f) => { if (t === 'message') oyentes.push(f); },
    open: () => (bloquearVentana ? null : emergente),
    setTimeout: () => 1, clearTimeout: () => {},
  };
  ctx.window = ctx; ctx.parent = ctx;
  vm.createContext(ctx);
  vm.runInContext(fuente, ctx);
  const enviar = (data, origin = PUBLICO, source = emergente) => oyentes.forEach(f => f({ data, origin, source }));
  return { ctx, aviso, parrafo, traer, cerrar, boton: grupo.hijos[0], emergente, enviar };
}
function migrar(datos, opciones) {
  const c = cuenta(opciones);
  c.boton.click();
  c.enviar({ tipo: 'wp-ajustes-listos' });
  // Los objetos del contexto simulado son de otro realm: se comparan como JSON.
  assert.equal(J(c.emergente.mensajes.at(-1)), J({ d: { tipo: 'wp-pedir-ajustes', nonce: 'nonce-sintetico' }, o: PUBLICO }));
  c.enviar({ tipo: 'wp-ajustes-locales', nonce: 'nonce-sintetico', datos });
  return c;
}
const J = JSON.stringify;
let casos = 0;
const probar = (nombre, fn) => { fn(); casos++; console.log('OK ' + nombre); };

probar('combina personajes por nombre y une favoritas, ocultas y prendas favoritas', () => {
  const c = migrar({
    wp_chars_v1: J([{ name: 'Ánima $1', hair: 'red hair', features: 'x' }, { name: "O'Hara", hair: 'hair', features: 'f' }]),
    wp_favs_v1: J(['escena-b', 'escena-a']), wp_deleted_v2: J(['oculta-2']), wp_outfit_favs_v1: J(['prenda-2']),
  }, { local: {
    wp_chars_v1: J([{ name: 'Ánima $1', hair: 'black hair', features: 'y' }]),
    wp_favs_v1: J(['escena-a']), wp_deleted_v2: J(['oculta-1']), wp_outfit_favs_v1: J(['prenda-1']),
  } });
  const m = c.ctx.localStorage;
  // El personaje que ya existía acá conserva sus datos; el que faltaba se suma.
  assert.deepEqual(JSON.parse(m.getItem('wp_chars_v1')), [{ name: 'Ánima $1', hair: 'black hair', features: 'y' }, { name: "O'Hara", hair: 'hair', features: 'f' }]);
  assert.deepEqual(JSON.parse(m.getItem('wp_favs_v1')), ['escena-a', 'escena-b']);
  assert.deepEqual(JSON.parse(m.getItem('wp_deleted_v2')), ['oculta-1', 'oculta-2']);
  assert.deepEqual(JSON.parse(m.getItem('wp_outfit_favs_v1')), ['prenda-1', 'prenda-2']);
  assert.equal(c.ctx.location.recargas, 1);
  assert.match(c.ctx.sessionStorage.getItem('wp_migracion_resumen'), /^Ajustes recuperados\. Se conservaron 1 dato que ya tenías acá con otro valor\.$/);
  assert.equal(m.getItem('wp_migracion_v1'), '1');
  assert.ok(c.emergente.cerrada);
});

probar('ediciones y contadores suman lo que falta sin pisar; las preferencias de acá mandan', () => {
  const c = migrar({
    wp_edits_v1: J({ 'escena-a': { prompt: 'traida' }, 'escena-b': { prompt: 'nueva' } }),
    wp_stats_v1: J({ 'escena-a': 9, 'escena-c': 2 }), wp_accent_v1: '200', wp_sort_v1: 'az', wp_edad_v1: '1',
  }, { local: { wp_edits_v1: J({ 'escena-a': { prompt: 'local' } }), wp_stats_v1: J({ 'escena-a': 1 }), wp_accent_v1: '30' } });
  const m = c.ctx.localStorage;
  assert.deepEqual(JSON.parse(m.getItem('wp_edits_v1')), { 'escena-a': { prompt: 'local' }, 'escena-b': { prompt: 'nueva' } });
  assert.deepEqual(JSON.parse(m.getItem('wp_stats_v1')), { 'escena-a': 1, 'escena-c': 2 });
  assert.equal(m.getItem('wp_accent_v1'), '30');
  assert.equal(m.getItem('wp_sort_v1'), 'az');
  assert.equal(m.getItem('wp_edad_v1'), '1');
  assert.match(c.ctx.sessionStorage.getItem('wp_migracion_resumen'), /Se conservaron 3 datos/);
});

probar('repetir la migración no duplica nada ni recarga', () => {
  const datos = { wp_chars_v1: J([{ name: 'A' }]), wp_favs_v1: J(['x']), wp_stats_v1: J({ x: 1 }) };
  const c = migrar(datos, { local: datos });
  assert.equal(c.ctx.location.recargas, 0);
  assert.equal(c.boton.textContent, 'No había ajustes nuevos para traer.');
  assert.equal(c.ctx.localStorage.getItem('wp_chars_v1'), datos.wp_chars_v1);
});

probar('datos dañados no rompen ni pisan lo de acá', () => {
  const c = migrar({ wp_chars_v1: '{roto', wp_favs_v1: J({ no: 'lista' }), wp_edits_v1: J(['no', 'mapa']), wp_stats_v1: 7 },
    { local: { wp_favs_v1: '[roto', wp_edits_v1: J({ a: 1 }) } });
  const m = c.ctx.localStorage;
  assert.equal(m.getItem('wp_chars_v1'), null);
  assert.equal(m.getItem('wp_favs_v1'), '[roto');
  assert.equal(m.getItem('wp_edits_v1'), J({ a: 1 }));
  assert.equal(c.ctx.location.recargas, 0);
});

probar('otro origen, otra ventana o un nonce ajeno no escriben nada', () => {
  const c = cuenta();
  c.boton.click();
  const datos = { wp_chars_v1: J([{ name: 'Intrusa' }]) };
  c.enviar({ tipo: 'wp-ajustes-locales', nonce: 'nonce-sintetico', datos }, 'https://ajeno.invalid');
  c.enviar({ tipo: 'wp-ajustes-locales', nonce: 'nonce-sintetico', datos }, PUBLICO, {});
  c.enviar({ tipo: 'wp-ajustes-locales', nonce: 'otro', datos });
  assert.equal(c.ctx.localStorage.getItem('wp_chars_v1'), null);
});

probar('el aviso se ofrece sólo la primera vez y muestra el resumen tras recargar', () => {
  const primera = cuenta();
  assert.equal(primera.aviso.hidden, false);
  // Queda recordado al mostrarse, aunque no se toque nada.
  assert.equal(primera.ctx.localStorage.getItem('wp_migracion_v1'), '1');
  primera.cerrar.click();
  assert.equal(primera.aviso.hidden, true);
  assert.equal(cuenta({ local: { wp_migracion_v1: '1' } }).aviso.hidden, true);
  const tras = cuenta({ local: { wp_migracion_v1: '1' }, sesion: { wp_migracion_resumen: 'Ajustes recuperados.' } });
  assert.equal(tras.aviso.hidden, false);
  assert.equal(tras.parrafo.textContent, 'Ajustes recuperados.');
  assert.equal(tras.traer.hidden, true);
  assert.equal(tras.ctx.sessionStorage.getItem('wp_migracion_resumen'), null);
});

probar('una ventana bloqueada lo dice en vez de quedar callada y deja reintentar', () => {
  const c = cuenta({ bloquearVentana: true });
  c.traer.click();
  assert.match(c.parrafo.textContent, /bloqueó la ventana/);
  assert.equal(c.traer.hidden, false, 'El botón sigue para reintentar');
});

console.log(casos + ' casos de migración de ajustes OK');
