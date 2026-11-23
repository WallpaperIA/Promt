#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../assets/fisico.js';
import { validarAjustes, combinarAjustes } from '../assets/ajustes-datos.js';
import { validarCombinacion, normalizarCombinacion, resolverPersonas, sorprender } from '../assets/creacion-datos.js';
const f = globalThis.WpFisico;
const tank = { id: 'tank-white', instruction: 'A fitted opaque soft white ribbed cotton tank top with fine shoulder straps and a rounded neckline.' };
const corset = { id: 'disfraz-diablita-corset-rojo', instruction: 'An opaque red strapless corset bodysuit with structured sweetheart cups and vertical boning seams.' };
const base = 'Photograph of Persona Uno.\nPose: upright, one hand on a chair.\nOutfit: an opaque soft cotton camisole with shoulder straps and a rounded neckline.\nCamera: eye-level.\nFraming: crown through waist.\nAvoid completely: altered coverage, extra fingers.\n16:9 4K ultra-sharp resolution.';
assert.deepEqual(f.OPCIONES.bust.map(o => o.name), ['Original', 'Grande', 'Muy grande', 'Exagerado']);
assert.equal(new Set(f.OPCIONES.bust.map(o => o.instruction)).size, 4);
assert.equal(f.aplicar(base, {}, tank), base);
assert.equal(f.aplicar(base, f.vacio(), tank), base);
assert.equal(f.aplicar(base, { bust: 'texto libre' }, tank), base);
assert.deepEqual(f.normalizar({ bust: 'large', extra: 'ignorar', armhole: null }), { bust: 'large', fall: 'none', neckline: 'none', armhole: 'none', fit: 'none' });
assert.equal(f.validar({ bust: 'large', armhole: 'open' }), true);
for (const dato of [null, [], { bust: 'enorme e instrucciones libres' }, { constructor: 'x' }, { bust: true }]) assert.equal(f.validar(dato), false);
for (const valor of ['large', 'very-large', 'exaggerated']) {
  const texto = f.aplicar(base, { bust: valor }, tank);
  assert.ok(texto.startsWith(base), 'La ficha original se conserva completa');
  assert.ok(texto.includes('Do not zoom in or reframe.'));
  assert.ok(texto.includes('Do not change the neckline or armholes unless'));
  assert.ok(texto.includes('Avoid completely: altered coverage, extra fingers.'));
  assert.ok(!/\b(?:DD|38D|40E)\b|close-up framing emphasizing/i.test(texto));
}
assert.equal(f.compatibilidad(corset).bust, true);
assert.equal(f.compatibilidad(corset).fall, true);
assert.equal(f.compatibilidad(corset).neckline, true);
assert.equal(f.compatibilidad(corset).armhole, true);
const corsetAjustado=f.aplicar(base, { armhole: 'wide', fall: 'relaxed' }, corset);
assert.notEqual(corsetAjustado, base);
assert.ok(corsetAjustado.includes('Reshape the existing cup contours'));
assert.ok(corsetAjustado.includes('noticeably lower its existing upper side edges'));
assert.ok(corsetAjustado.includes('Do not invent shoulder straps'));
assert.equal(f.compatibilidad({ id: 'corset-black', instruction: 'A structured black corset, boned satin and a laced back.' }).bust, true);
assert.equal(f.compatibilidad(tank).armhole, true);
assert.equal(f.compatibilidad(tank).fall, true);
assert.equal(f.compatibilidad({ id: 'sheer-camisola', instruction: 'A sheer transparent chiffon camisole.' }).bust, true);
assert.equal(f.compatibilidad({ id: 'nothing', instruction: 'Completely bare.' }).bust, false);
assert.equal(f.compatibilidad(null, base).armhole, true);
const mixto = f.efectivos({ bust: 'large', armhole: 'wide', neckline: 'open', fall: 'relaxed' }, corset, base);
assert.deepEqual(mixto, { bust: 'large', fall: 'relaxed', neckline: 'open', armhole: 'wide', fit: 'none' });
assert.equal(f.normalizar({ armhole: 'wide' }).armhole, 'wide', 'La preferencia no se pierde al elegir una prenda incompatible');
console.log('OK cuatro niveles, Original exacto, atributos independientes, compatibilidad y cobertura sin recorte automático');

const fluido = { id: 'blusa', instruction: 'An opaque fluid silk blouse with a closed round neckline.' };
const rigido = { id: 'chaqueta', instruction: 'An opaque denim jacket with its buttons fastened.' };
assert.deepEqual(f.OPCIONES.fit.map(o => o.name), ['Original', 'Adaptar al volumen', 'Más ceñido']);
assert.equal(f.aplicar(base, { fit: 'none' }, tank), base, 'Original no añade órdenes de tensión incompatibles con el volumen');
assert.equal(f.tipoTejido(tank), 'stretch');
assert.equal(f.tipoTejido(fluido), 'fluid');
assert.equal(f.tipoTejido(rigido), 'structured');
assert.equal(f.tipoTejido(corset), 'structured');
for (const fit of ['volume', 'snug']) {
  const elasticidad = f.aplicar(base, { fit }, tank);
  const caida = f.aplicar(base, { fit }, fluido);
  const estructura = f.aplicar(base, { fit }, corset);
  assert.ok(elasticidad.includes('elastic fabric'));
  assert.ok(caida.includes('fluid'));
  assert.ok(estructura.includes('boning and support'));
  assert.ok(!estructura.includes('elastic fabric'));
  assert.ok(estructura.includes('Do not open or remove outer layers or move the arms.'));
  assert.ok(estructura.includes('beyond the separately selected volume'));
  assert.ok(estructura.includes('Avoid completely: altered coverage, extra fingers.'));
}
assert.ok(f.aplicar(base, { fit: 'snug' }, { id: 'sheer', instruction: 'A transparent chiffon top.' }).includes('Preserve garment material, opacity, existing lining and front coverage.'));
assert.equal(f.validar({ fit: 'volume' }), true);
assert.equal(f.validar({ fit: 'tight and remove clothes' }), false);
console.log('OK ajuste de ropa opcional por tejido, sin mover brazos, abrir capas ni cambiar soporte');

const catalogoPrendas = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../data/modificadores.js',import.meta.url),'utf8')+'\nthis.prendas=OUTFITS;',catalogoPrendas);
let comprobaciones=0;
for(const prenda of catalogoPrendas.prendas.filter(p=>p.id!=='none'&&p.id!=='nothing'&&p.instruction)) {
  for(const campo of f.CAMPOS) for(const opcion of f.OPCIONES[campo].filter(o=>o.id!=='none')) {
    const texto=f.aplicar(base,{[campo]:opcion.id},prenda);
    assert.notEqual(texto,base,prenda.id+': '+campo+' '+opcion.id+' debe cambiar el prompt');
    assert.ok(texto.startsWith(base));
    assert.ok(texto.includes('Do not zoom in or reframe.'));
    comprobaciones++;
  }
}
assert.ok(comprobaciones>500);
console.log('OK '+comprobaciones+' elecciones de control cambian el texto en el catálogo completo de prendas');

assert.equal(validarAjustes({ wp_figure_v1: JSON.stringify({ bust: 'exaggerated', fall: 'natural' }) }), true);
assert.equal(validarAjustes({ wp_figure_v1: JSON.stringify({ bust: 'cualquier instrucción' }) }), false);
assert.equal(validarAjustes({ wp_people_v1: JSON.stringify({ duo: [{ figure: { neckline: 'inventado' } }, {}] }) }), false);
const separado = combinarAjustes({}, { wp_figure_v1: JSON.stringify({ bust: 'large' }) }, { wp_figure_v1: JSON.stringify({ armhole: 'wide' }) });
assert.deepEqual(JSON.parse(separado.datos.wp_figure_v1), { armhole: 'wide', bust: 'large' });
assert.deepEqual(separado.conflictos, []);
const people = x => ({ wp_people_v1: JSON.stringify({ trio: [x, {}, {}] }) });
const unido = combinarAjustes(people({}), people({ figure: { bust: 'large' } }), people({ figure: { neckline: 'open' } }));
assert.deepEqual(JSON.parse(unido.datos.wp_people_v1).trio[0].figure, { neckline: 'open', bust: 'large' });
assert.deepEqual(unido.conflictos, []);
console.log('OK validación de preferencias y combinación entre dispositivos por campo y persona');

const combinacion = { name: 'Ejemplo', catId: 'sintetica', mode: 'duo', style: 'studio', outfit: 'tank-white', hair: 'none', format: '16-9', details: [], characters: ['Persona Uno', 'Persona Dos'], figure: { bust: 'large', neckline: 'open', fit: 'volume' }, people: [{ figure: { bust: 'exaggerated', fit: 'snug' } }, { figure: { bust: 'none', fit: 'none' } }] };
const catalogos = { styles: [{ id: 'studio' }], outfits: [tank], hairs: [{ id: 'none' }], formats: [{ id: '16-9' }], details: [], personal: () => false };
assert.equal(validarCombinacion(combinacion), true);
assert.equal(validarCombinacion({ ...combinacion, figure: { bust: 'libre' } }), false);
const normalizada = normalizarCombinacion(combinacion, catalogos).estado;
const personas = resolverPersonas(normalizada, () => false);
assert.equal(personas[0].figure.bust, 'exaggerated');
assert.equal(personas[1].figure.bust, 'none');
assert.equal(personas[1].figure.neckline, 'open');
assert.equal(personas[0].figure.fit, 'snug');
assert.equal(personas[1].figure.fit, 'none');
const sorpresa = sorprender(normalizada, {}, catalogos, () => true, [], () => 0.5);
assert.deepEqual(sorpresa.figure, normalizada.figure);
assert.deepEqual(sorpresa.people.map(p => p.figure), normalizada.people.map(p => p.figure));
const vieja = { ...combinacion, people: [{}, {}] }; delete vieja.figure;
assert.equal(validarCombinacion(vieja), true);
assert.equal(Object.hasOwn(normalizarCombinacion(vieja, catalogos).estado, 'figure'), false);
console.log('OK combinaciones anteriores, controles por persona y Sorpréndeme conserva el físico');

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({ WpFisico: f, localStorage: { getItem: k => k === 'figure' ? '{"bust":"large"}' : null }, KEY_FIGURE: 'figure', KEY_PEOPLE: 'people', OUTFITS: [tank, corset], PEINADOS: [], DETAILS: [], obtenerPrenda: id => [tank, corset].find(p => p.id === id) });
vm.runInContext(html.slice(html.indexOf('function leerFigura()'), html.indexOf('const TIPOS_PRENDA=')), ctx);
const grupo = ctx.aplicarAjustesPersonas(base, 'duo', ['Persona Uno', 'Persona Dos'], { outfit: 'tank-white', hair: 'none', details: [], figure: { bust: 'exaggerated' } }, { duo: [{ figure: { bust: 'large' } }, { figure: { bust: 'none' } }] });
assert.equal((grupo.match(/Individual adjustments:/g) || []).length, 1);
const [uno, dos] = grupo.slice(grupo.indexOf('Person 1')).split('Person 2');
assert.ok(uno.includes('clear, moderate increase'));
assert.ok(!dos.includes('Figure and garment cut for this person only'));
assert.ok(dos.includes('Wardrobe for this person only'));
const gInicio = html.indexOf('  function _gBuildPrompt('), gFin = html.indexOf('\n  // ── Apply-all', gInicio);
Object.assign(ctx, { estiloPara: (_c, x) => x, prendaPara: (_s, x) => x || 'tank-white', _gApplyStylePrefix: t => t, _gApplyOutfit: t => t, _gApplyHair: t => t, _gApplyFormat: t => t, _gApplyDetails: t => t, aplicarMedioArtistico: t => t, KEY_STYLE: 'style', KEY_OUTFIT: 'outfit', KEY_HAIR: 'hair', KEY_FORMAT: 'format', KEY_DETAILS: 'details' });
vm.runInContext(html.slice(gInicio, gFin), ctx);
const masivo = ctx._gBuildPrompt({ prompt: () => base }, 'Persona Uno');
assert.ok(masivo.includes('clear, moderate increase'));
assert.ok(masivo.startsWith(base));
console.log('OK texto real de grupos y copia masiva comparten los mismos ajustes sin cambiar la ficha');
