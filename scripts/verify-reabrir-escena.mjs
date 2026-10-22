#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// "Volver donde quedó": se ejecuta el código real del HTML con un DOM y un
// almacenamiento sintéticos. Sólo IDs públicos; ningún nombre ni prompt.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const inicio = html.indexOf('let ultimaEscenaId=');
const fin = html.indexOf("document.getElementById('continuar-olvidar')", inicio);
assert.ok(inicio >= 0 && fin > inicio, 'No se encontró el bloque de la última escena');
const fuente = html.slice(inicio, fin);
const clave = html.match(/const KEY_OPEN_SCENE = '([^']+)'/)?.[1];
assert.equal(clave, 'wp_open_scene_v1');

let casos = 0;
function entorno({ guardado = {}, catalogo, ocultas = [] } = {}) {
  const datos = new Map(Object.entries(guardado));
  let abierta = null;
  const llamadas = [], cuadros = [], metricasDurante = [];
  const nodo = () => ({ hidden: true, textContent: '' });
  const continuar = nodo(), nombre = nodo();
  const contexto = vm.createContext({
    KEY_LAST_SCENE: 'wp_last_scene_v1', KEY_OPEN_SCENE: clave,
    localStorage: {
      getItem: k => (datos.has(k) ? datos.get(k) : null),
      setItem: (k, v) => datos.set(k, String(v)), removeItem: k => datos.delete(k),
    },
    document: {
      querySelector: s => (s === '.section.open' && abierta ? { closest: () => ({ dataset: { id: abierta } }) } : null),
      getElementById: id => (id === 'continuar-escena' ? continuar : nombre),
    },
    CATEGORIES: catalogo || [{ id: 'playa', ready: true, name: 'Playa' }, { id: 'ventana', ready: true, name: 'Ventana' }, { id: 'pronto', ready: false, name: 'Pronto' }],
    getTrash: () => ocultas, cleanName: s => s,
    requestAnimationFrame: f => { cuadros.push(f); return cuadros.length; },
  });
  vm.runInContext(fuente, contexto);
  contexto.irACategoria = id => { llamadas.push(id); metricasDurante.push(vm.runInContext('reabriendoEscena', contexto)); };
  const correr = codigo => vm.runInContext(codigo, contexto);
  return {
    correr, datos, llamadas, cuadros, metricasDurante, continuar,
    abrir: id => { abierta = id; }, cerrar: () => { abierta = null; },
    guardada: () => (datos.has(clave) ? datos.get(clave) : null),
  };
}
const probar = (nombre, fn) => { fn(); casos++; };

probar('se guarda la escena abierta que cargó su prompt, con su modo', () => {
  const e = entorno();
  e.correr('reabrirEscenaAbierta()');
  e.abrir('playa'); e.correr("guardarUltimaEscena('playa')");
  assert.equal(e.guardada(), 'playa');
  e.correr("recordarModoEscena('playa','duo')");
  assert.equal(e.guardada(), 'playa|duo');
  assert.equal(e.correr("modoEscenaGuardada('playa')"), 'duo');
  assert.equal(e.correr("modoEscenaGuardada('ventana')"), 'solo', 'El modo es de esa escena y de ninguna otra');
  e.correr("recordarModoEscena('ventana','trio')");
  assert.equal(e.guardada(), 'playa|duo');
  e.correr('recordarEscenaAbierta()');
  assert.equal(e.guardada(), 'playa|duo', 'Repintar no borra el modo');
});

probar('cerrar, volver a Explorar o abrir una bloqueada olvidan la escena', () => {
  const e = entorno();
  e.correr('reabrirEscenaAbierta()');
  e.abrir('playa'); e.correr("guardarUltimaEscena('playa')");
  e.cerrar(); e.correr('recordarEscenaAbierta()');
  assert.equal(e.guardada(), null);
  e.abrir('playa'); e.correr('recordarEscenaAbierta()');
  assert.equal(e.guardada(), 'playa', 'Reabrirla a mano la vuelve a guardar');
  e.abrir('ventana'); e.correr('recordarEscenaAbierta()');
  assert.equal(e.guardada(), null, 'Una escena que no cargó su prompt no se reabre');
  e.abrir('playa'); e.correr('recordarEscenaAbierta()');
  e.correr('olvidarUltimaEscena()');
  assert.equal(e.guardada(), null, 'Salir o cambiar de sesión la olvida');
  assert.equal(e.datos.has('wp_last_scene_v1'), false);
});

probar('al volver se reabre la que quedó abierta, sin contarse como apertura', () => {
  const e = entorno({ guardado: { wp_last_scene_v1: 'playa', [clave]: 'playa|trio' } });
  // Mientras se arma la página nada está abierto: no se borra lo guardado.
  e.correr('recordarEscenaAbierta()');
  assert.equal(e.guardada(), 'playa|trio');
  e.correr('reabrirEscenaAbierta()');
  assert.deepEqual(e.llamadas, ['playa']);
  assert.deepEqual(e.metricasDurante, [true], 'Reabrir no se mide como abrir-escena');
  assert.equal(e.correr('reabriendoEscena'), false);
  assert.equal(e.cuadros.length, 1);
  e.cuadros[0](); e.cuadros[1]();
  assert.deepEqual(e.llamadas, ['playa', 'playa'], 'Se vuelve a acercar cuando la fila ya se ve');
  assert.equal(e.correr("modoEscenaGuardada('playa')"), 'trio');
});

for (const [nombre, opciones] of [
  ['oculta en este navegador', { ocultas: ['playa'] }],
  ['retirada del catálogo', { catalogo: [{ id: 'ventana', ready: true, name: 'Ventana' }] }],
  ['todavía no lista', { guardado: { wp_last_scene_v1: 'pronto', [clave]: 'pronto' } }],
  ['de otra sesión', { guardado: { [clave]: 'playa' } }],
  ['con un valor inválido', { guardado: { wp_last_scene_v1: 'playa', [clave]: '../playa|quad' } }],
]) {
  probar('no se reabre una escena ' + nombre, () => {
    const e = entorno({ ...opciones, guardado: opciones.guardado || { wp_last_scene_v1: 'playa', [clave]: 'playa' } });
    e.correr('reabrirEscenaAbierta()');
    assert.deepEqual(e.llamadas, []);
    assert.equal(e.guardada(), opciones.guardado?.[clave] === '../playa|quad' ? '../playa|quad' : null, 'Lo que no se puede reabrir se olvida');
  });
}

probar('si mientras cargaba se eligió otra escena, manda esa', () => {
  const e = entorno({ guardado: { wp_last_scene_v1: 'playa', [clave]: 'playa' } });
  e.abrir('ventana');
  e.correr('reabrirEscenaAbierta()');
  assert.deepEqual(e.llamadas, []);
  assert.equal(e.guardada(), null);
});

console.log(casos + ' casos: la escena abierta vuelve al recargar, con su modo, y se olvida al cerrarla');
