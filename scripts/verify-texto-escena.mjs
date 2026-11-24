#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const leer = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = leer('index.html');
const datos = new Map();
const ctx = vm.createContext({
  localStorage: { getItem: k => datos.get(k) ?? null },
  KEY_PRENDA_PERSONAL: 'custom', KEY_STYLE: 'wp_style_v1', KEY_OUTFIT: 'wp_outfit_v1', KEY_HAIR: 'wp_hair_v1',
  _canAccessTier: () => true,
});
vm.runInContext(leer('data/modificadores.js') + '\n' + leer('assets/fisico.js') + '\n' + leer('assets/texto-escena.js'), ctx);
const motor = ctx.WpTextoEscena;
const estilos = [{ id: 'a', prefix: 'PHOTO' }, { id: 'b', prefix: 'STUDIO' }];
for (const texto of ['Retrato de Ensayo A frente a una pared.', 'Ensayo A stands near the edge of a pool.', '__N__ stands near the edge of a pool.']) {
  const salida = motor.cambiarEstilo(texto, estilos[1], estilos);
  assert.ok(salida.includes(texto), 'Una apertura desconocida se conserva completa, sin recortar identidad o pose');
  assert.ok(salida.startsWith('STUDIO'));
}
assert.equal(motor.cambiarEstilo('PHOTO of Ensayo A. Pose: KEEP.', estilos[1], estilos), 'STUDIO of Ensayo A. Pose: KEEP.');
assert.equal(motor.cambiarEstilo('KEEP.', null, estilos), 'KEEP.');
for (const final of ['', '.', '\n', '.\r\n']) {
  const base = 'Portrait of Ensayo A' + final;
  const salida = motor.agregarDetalles(base, [{ prompt: 'EXTRA_ELEGIDO' }]);
  assert.ok(salida.includes('EXTRA_ELEGIDO'), 'Extras se aplica con o sin punto final');
  assert.ok(salida.startsWith(base.trimEnd()));
  assert.equal(motor.agregarDetalles(base, []), base, 'Sin Extras el cuerpo queda exacto');
}
console.log('OK regresiones: estilos sin perder nombre/pose y Extras con cualquier final');

// Los adaptadores reales de la ficha y la copia masiva delegan en el módulo.
vm.runInContext(html.slice(html.indexOf('function cambiarFormato('), html.indexOf('const TIPOS_PRENDA=')), ctx);
const inicio = html.indexOf('  function _gBuildPrompt('), fin = html.indexOf('\n  // ── Apply-all', inicio);
vm.runInContext(html.slice(inicio, fin), ctx);
vm.runInContext(html.slice(html.indexOf('    function textoFinal('), html.indexOf('    /** Copia con')), ctx);
const cuerpo = nombres => 'Synthetic portrait of ' + nombres.join(' and ') + '.\nPose: KEEP_POSE.\nExpression: KEEP_GAZE.\nOutfit: An opaque plain cotton tank top.\nHair: KEEP_HAIR.\nLighting: KEEP_LIGHT.\nBackground: KEEP_ROOM.\nCamera: KEEP_CAMERA.\nFraming: KEEP_CROP.\n16:9 4K ultra-sharp resolution.';
ctx.textoBase = (_modo, nombres) => cuerpo(nombres);
ctx.ajustesPersonas = { duo: [{}, {}], trio: [{}, {}, {}] };
const listas = vm.runInContext('({STYLES,OUTFITS,HAIRSTYLES,FORMATS,DETAILS})', ctx);
const prendida = listas.OUTFITS.find(o => o.id === 'tank-white'); assert.ok(prendida);
const peinado = listas.HAIRSTYLES.find(h => h.instruction); assert.ok(peinado);
const extra = listas.DETAILS.find(d => d.prompt); assert.ok(extra);
const formato = listas.FORMATS.find(f => f.id !== '16-9'); assert.ok(formato);
const nombre = 'Ensayo $& [A]';
let comparaciones = 0;
for (const estilo of listas.STYLES) for (const outfit of ['none', prendida.id]) for (const hair of ['none', peinado.id])
  for (const details of [[], [extra.id]]) for (const figure of [{}, { bust: 'large' }]) for (const format of ['16-9', formato.id]) {
    Object.assign(ctx, { currentStyleId: estilo.id, currentOutfitId: outfit, currentHairId: hair, activeDetailIds: new Set(details), currentFigure: figure, currentFormatId: format });
    for (const [k, v] of Object.entries({ wp_style_v1: estilo.id, wp_outfit_v1: outfit, wp_hair_v1: hair, wp_details_v1: JSON.stringify(details), wp_figure_v1: JSON.stringify(figure), wp_format_v1: format })) datos.set(k, v);
    const individual = ctx.textoFinal('solo', [nombre]);
    const masivo = ctx._gBuildPrompt({ prompt: n => cuerpo([n]) }, nombre);
    assert.equal(individual, masivo, 'Ficha y copia masiva deben producir exactamente el mismo texto');
    for (const t of [nombre, 'KEEP_POSE', 'KEEP_GAZE', 'KEEP_CAMERA', 'KEEP_CROP']) assert.ok(individual.includes(t));
    comparaciones++;
  }
assert.ok(comparaciones >= 500);
console.log('OK ' + comparaciones + ' configuraciones idénticas entre ficha y copia masiva');

Object.assign(ctx, { currentStyleId: 'playboy', currentOutfitId: 'none', currentHairId: 'none', currentFormatId: '16-9', activeDetailIds: new Set(), currentFigure: { bust: 'large' } });
ctx.ajustesPersonas = { duo: [{}, { figure: { bust: 'none' } }], trio: [{}, { figure: { bust: 'none' } }, { figure: { bust: 'exaggerated' } }] };
for (const modo of ['duo', 'trio']) {
  const nombres = ['Ensayo A', 'Ensayo B', 'Ensayo C'].slice(0, modo === 'duo' ? 2 : 3);
  const salida = ctx.textoFinal(modo, nombres);
  assert.ok(salida.includes('Person 1 (named "Ensayo A")'));
  assert.ok(!salida.includes('Person 2 (named "Ensayo B"):\nFigure and garment cut'));
  assert.ok(salida.includes('KEEP_POSE') && salida.includes('KEEP_GAZE') && salida.includes('KEEP_CROP'));
  if (modo === 'trio') assert.ok(salida.includes('Person 3 (named "Ensayo C")'));
}
console.log('OK Dúo y Trío conservan Original individual, nombres, pose, mirada y encuadre');

assert.ok(!/WpSegundos|Copiar imagen base|Copiar segundo prompt|sinFisico/.test(html));
assert.ok(html.includes("botonesAjuste.filter(b=>b!==btnOutfit).forEach"));
assert.ok(html.includes('prendaRapida.append(btnOutfit)'));
assert.ok(html.includes("panelPersonalizar=document.createElement('details')"));
assert.ok(html.includes("tituloPersonalizar.textContent='Personalizar'"));
assert.ok(html.includes('¿Cómo corrijo una imagen ya generada?'));
assert.ok(!/function (?:_gApply|applyStylePrefix|applyDetailsInstruction)/.test(html));
assert.ok(!leer('assets/texto-escena.js').includes('localStorage'));
console.log('OK recorrido con una copia principal, Prenda visible, Personalizar plegable y ayuda fuera de las fichas');

vm.runInContext(leer('assets/personajes-en-uso.js'),ctx);
const nombresEnUso=ctx.WpPersonajesEnUso;
nombresEnUso.guardar('duo',['Ensayo A','Ensayo B']);
const copia=nombresEnUso.leer('duo');copia[0]='OTRA';
assert.equal(nombresEnUso.leer('duo')[0],'Ensayo A','El estado no se modifica por una lectura');
const campo=()=>({value:'',addEventListener(_tipo,fn){this.input=fn;}});
const primera=[campo(),campo()];const refrescarPrimera=nombresEnUso.vincular('duo',primera);
assert.equal(primera[0].value,'Ensayo A');assert.equal(primera[1].value,'Ensayo B');
primera[0].value='Ensayo C';primera[0].input();
const siguiente=[campo(),campo()];nombresEnUso.vincular('duo',siguiente);
assert.equal(siguiente[0].value,'Ensayo C','La escena siguiente conserva los nombres visibles');
siguiente[0].value='Ensayo D';siguiente[0].input();
refrescarPrimera();
assert.equal(primera[0].value,'Ensayo D','Una ficha ya construida toma los nombres actuales al reabrirse');
siguiente.forEach(c=>{c.value='';c.input();});
refrescarPrimera();assert.ok(primera.every(c=>c.value===''),'Reabrir no recupera nombres que ya se borraron');
const vacios=[campo(),campo()];nombresEnUso.vincular('duo',vacios);
assert.ok(vacios.every(c=>c.value===''),'Limpiar los campos también limpia los nombres recordados');
assert.ok(nombresEnUso.leer('solo').every(n=>!n),'Los modos no mezclan sus participantes');
assert.ok(!/localStorage|sessionStorage/.test(leer('assets/personajes-en-uso.js')));
assert.ok(html.includes('if(bodyBuilt){ sec._reusarNombres?.(); return; }'));
console.log('OK nombres en memoria: reutilizados entre escenas, modos separados y limpieza sin datos ocultos');
