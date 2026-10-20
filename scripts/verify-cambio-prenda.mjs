#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Fragmentos sintéticos: ninguna escena del catálogo ni nombres reales.
const leer=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=leer('index.html');
const desde=html.indexOf('function cambiarPrenda('),hasta=html.indexOf('// Los peinados llegan',desde);
assert.ok(desde>=0&&hasta>desde);
// La lista de retiradas va también: cambiarPrenda() tiene que reconocer las
// notas que dejaron esas prendas en ediciones y versiones anteriores.
const retiro=html.slice(html.indexOf('const PRENDAS_RETIRADAS='),html.indexOf('// El catálogo de filtros contiene'));
assert.ok(retiro.includes('const INSTRUCCIONES_PRENDA='));
const ctx=vm.createContext({});
vm.runInContext(leer('data/modificadores.js')+'\n'+retiro+'\n'+html.slice(desde,hasta),ctx);
const cambiar=ctx.cambiarPrenda,opciones=ctx.OUTFITS;
const id='voile-shirt-bodysuit',nota=opciones.find(o=>o.id===id).instruction;
const prefijo='MARCADOR __N1__ / __N2__ / __N3__.\nPose: CONSERVAR_BRAZOS_Y_MANOS.\nExpression: CONSERVAR_MIRADA.\n';
const resto='Hair: __N1_HAIR__ / __N2_HAIR__ / __N3_HAIR__.\nSkin: CONSERVAR.\nLighting: CONSERVAR_LUZ.\nBackground: CONSERVAR_FONDO.\nCamera: CONSERVAR_CAMARA.\nFraming: CONSERVAR_ENCUADRE.\nMicro-details: CONSERVAR_DETALLES.\nAvoid completely: CONSERVAR_LIMITES.\n16:9 4K ultra-sharp resolution.';
for(const etiqueta of ['Outfit: ','Wardrobe: ','Clothing: ','Vestuario: ','Ropa: ','Prenda: ','**Outfit:** ','**Outfit**: ']){
  const fuente=prefijo+etiqueta+'VESTUARIO_ANTERIOR.\n'+resto;
  const resultado=cambiar(fuente,id);
  assert.ok(resultado.startsWith(prefijo+etiqueta));
  assert.ok(resultado.endsWith('\n'+resto),'El resto de la escena se conserva byte a byte');
  assert.ok(resultado.includes(nota));assert.ok(!resultado.includes('VESTUARIO_ANTERIOR'));
  assert.equal(cambiar(resultado,id),resultado,'Reaplicar no duplica la prenda');
  assert.equal(cambiar(fuente,'none'),fuente);assert.equal(cambiar(fuente,'id-inexistente'),fuente);
}
console.log('OK sólo se sustituye Outfit/Vestuario, sin perder pose, nombres, pelo, entorno, formato ni límites');

const inline='Pose: CONSERVAR. Outfit: VESTUARIO_ANTERIOR. Hair: CONSERVAR_PELO. 16:9 4K ultra-sharp resolution.';
const inlineNuevo=cambiar(inline,id);
assert.ok(inlineNuevo.startsWith('Pose: CONSERVAR. Outfit: '));
assert.ok(inlineNuevo.endsWith('Hair: CONSERVAR_PELO. 16:9 4K ultra-sharp resolution.'));
assert.ok(!inlineNuevo.includes('VESTUARIO_ANTERIOR'));
const crlf=(prefijo+'Outfit: VESTUARIO_ANTERIOR.\n'+resto).replace(/\n/g,'\r\n');
assert.ok(cambiar(crlf,id).endsWith(resto.replace(/\n/g,'\r\n')));
for(const final of ['Outfit: VESTUARIO_ANTERIOR.\n16:9 4K ultra-sharp resolution.','Outfit: VESTUARIO_ANTERIOR. 9:16 vertical 4K ultra-sharp resolution.']){
  assert.ok(cambiar(final,id).endsWith(final.slice(final.indexOf(final.includes('16:9')?'16:9':'9:16'))));
}
const repetido='Outfit 1: VESTUARIO_A.\nPose: CONSERVAR.\nOutfit 2: VESTUARIO_B.\nHair: CONSERVAR_PELO.';
const nuevo=cambiar(repetido,id);
assert.ok(!/VESTUARIO_[AB]/.test(nuevo));assert.ok(nuevo.includes('Pose: CONSERVAR.'));assert.ok(nuevo.endsWith('Hair: CONSERVAR_PELO.'));
console.log('OK etiquetas en línea, Markdown, CRLF, bloques repetidos y resolución al final');

const legado='MARCADOR __N__. TEXTO_SIN_BLOQUES_CON_POSE_Y_ROPA.';
const fallback=cambiar(legado,id);
assert.ok(fallback.startsWith(legado));assert.ok(fallback.includes('Wardrobe override: '));
assert.ok(fallback.includes('replaces all earlier clothing descriptions'));
assert.equal(cambiar(fallback,id),fallback);
const otra='plumetis-tulle-minidress',otraNota=opciones.find(o=>o.id===otra).instruction;
const cambiada=cambiar(fallback,otra);
assert.ok(cambiada.startsWith(legado));assert.ok(cambiada.includes(otraNota));assert.ok(!cambiada.includes(nota));
const anterior=legado+' Important styling note: '+otraNota+' Adapt all fabric, lighting, and texture interactions accordingly.';
assert.ok(!cambiar(anterior,id).includes(otraNota),'Se quita una nota final exacta del formato anterior');
const personal=legado+' Important styling note: TEXTO_PROPIO.';
assert.ok(cambiar(personal,id).startsWith(personal),'No se elimina una nota libre del usuario');
const soloMarcador='Outfit: __N1__ con VESTUARIO_ANTERIOR.\nPose: CONSERVAR.';
assert.ok(cambiar(soloMarcador,id).startsWith(soloMarcador),'No se pierde un marcador que sólo aparecía en Outfit');
for(const nombre of ["Nombre d'Ensayo",'Nombre $& $1']){
  const soloNombre='Outfit: '+nombre+' con VESTUARIO_ANTERIOR.\nPose: CONSERVAR.';
  assert.ok(cambiar(soloNombre,id,[nombre]).startsWith(soloNombre),'No se pierde un nombre completado');
}
console.log('OK formato antiguo conservado, prioridad explícita, notas anteriores y protección de nombres');

for(const nombre of ['applyOutfitInstruction','_gApplyOutfit']){
  const re=new RegExp('function '+nombre+'\\([^]*?\\n[ \\t]*\\}');
  const fn=html.match(re)?.[0];assert.ok(fn);
  vm.runInContext(fn,ctx);
  assert.equal(ctx[nombre](inline,id),inlineNuevo,'La ruta usa la misma transformación: '+nombre);
}
assert.ok(html.includes('applyOutfitInstruction(t,prendaPara(estilo,currentOutfitId),nombres)'));
assert.ok(html.includes('_gApplyOutfit(t, outfitId, [name])'));
console.log('OK copia individual y Un nombre en todas comparten la regla');

// Una edición o versión guardada con la nota de una prenda ya retirada:
// elegir otra la reemplaza en vez de pedir dos prendas a la vez.
const retirada=vm.runInContext('[...PRENDAS_RETIRADAS][0]',ctx);
const fuenteSinFiltrar=vm.createContext({});
vm.runInContext(leer('data/modificadores.js'),fuenteSinFiltrar);
const todas=vm.runInContext('OUTFITS',fuenteSinFiltrar);
const notaRetirada=(todas.find(o=>o.id===retirada)||{}).instruction;
if(notaRetirada){
  const vieja='Photo of __N__ by the window.\nPose: CONSERVAR.\n16:9 4K ultra-sharp resolution. Important styling note: '+notaRetirada+' Adapt all fabric, lighting, and texture interactions accordingly.';
  const nueva=cambiar(vieja,id);
  assert.ok(!nueva.includes(notaRetirada),'La nota de la prenda retirada se quita');
  assert.ok(nueva.includes(nota));
  assert.ok(nueva.startsWith('Photo of __N__ by the window.\nPose: CONSERVAR.\n16:9 4K ultra-sharp resolution.'));
}else{
  // Sin la fuente de modificadores no hay notas retiradas que probar.
  assert.fail('No se encontró la instrucción de la prenda retirada '+retirada);
}
// "Outfit:" con la descripción en la línea de abajo no queda pegado.
const abajo=cambiar('Photo of __N__.\nOutfit:\nVESTUARIO_ANTERIOR.\nHair:\nCONSERVAR.',id);
assert.ok(abajo.includes('Outfit: '+nota),abajo.slice(0,80));
assert.ok(abajo.endsWith('\nHair:\nCONSERVAR.'));
console.log('OK las notas de prendas retiradas se reemplazan y "Outfit:" con salto conserva el espacio');
