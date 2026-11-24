#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Sólo opciones públicas y una ficha inventada; ningún cuerpo privado.
const leer = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = leer('index.html');
const ctx = vm.createContext({});
vm.runInContext(leer('assets/fisico.js') + '\n' + leer('assets/edicion-imagen.js'), ctx);
const api = ctx.WpSegundos, fisico = ctx.WpFisico;
const tank = { id: 'tank', instruction: 'An opaque ribbed cotton tank top with thin straps.' };
const corset = { id: 'corset', instruction: 'A structured corset with boning and molded cups.' };
const bandeau = { id: 'bandeau', instruction: 'An opaque strapless bandeau.' };
const persona = (figure = {}, nombre = 'Ensayo A', prenda = tank) => ({ nombre, figure, prenda });
const original = api.instruccion({ personas: [persona()] });
assert.ok(!/Aumenta|Amplía|gira el torso/.test(original));
assert.ok(original.includes('Conserva todas las poses'));
assert.ok(original.includes('Conserva los guiños'));
const niveles = ['large', 'very-large', 'exaggerated'].map(bust => api.instruccion({ personas: [persona({ bust })] }));
assert.equal(new Set(niveles).size, 3);
for (const t of niveles) {
  assert.ok(t.length < 1100, 'La edición Solo es breve y no vuelve a describir la escena');
  assert.ok(!/Amplía|gira el torso|\b\d+\s*[DEF]\b/.test(t));
  assert.ok(t.includes('Conserva todas las poses'));
}
const aislado = api.instruccion({ personas: [persona({ bust: 'large' }), persona({}, 'Ensayo B'), persona({ armhole: 'wide' }, 'Ensayo C')] });
assert.ok(aislado.includes('Persona 1 ("Ensayo A"): Aumenta'));
assert.ok(!aislado.includes('Persona 2 ("Ensayo B"):'));
assert.ok(aislado.includes('Persona 3 ("Ensayo C"): Amplía mucho las sisas'));
const iguales = api.instruccion({ personas: [persona({ bust: 'exaggerated' }), persona({ bust: 'exaggerated' }, 'Ensayo B')] });
assert.equal((iguales.match(/Aumenta mucho/g) || []).length, 1);
assert.ok(iguales.includes('Persona 1 ("Ensayo A") y Persona 2 ("Ensayo B")'));
assert.ok(api.cambios(persona({ fall: 'relaxed' }, '', corset)).includes('conservando su soporte'));
assert.ok(!api.cambios(persona({ fall: 'relaxed' }, '', corset)).includes('sin soporte'));
assert.ok(api.cambios(persona({ armhole: 'wide' }, '', bandeau)).includes('corte lateral superior'));
assert.ok(!api.cambios(persona({ armhole: 'wide' }, '', bandeau)).includes('las sisas'));
assert.equal(api.cambios(persona({ bust: 'large', armhole: 'wide' }, '', { id: 'nothing', instruction: '' })), '');
const perfil = api.instruccion({ personas: [persona(), persona({}, 'Ensayo B')], destino: '1', perfil: true, espejo: true });
assert.ok(perfil.includes('Persona 2 ("Ensayo B"): gira el torso de perfil'));
assert.ok(!perfil.includes('Persona 1 ("Ensayo A"): gira'));
assert.ok(perfil.includes('Conserva la pose de las personas sin un cambio de vista indicado'));
assert.ok(perfil.includes('lente reflejado'));
console.log('OK segundo prompt: niveles distintos, cambios acotados, soporte, sisa, guiños y vista opcional por persona');

// Ejecutar el ensamblador real con una ficha sintética y las mismas opciones.
const ficha = 'Photo of Ensayo A and Ensayo B.\nPose: KEEP_POSE.\nOutfit: Opaque gray tops.\nHair: KEEP_HAIR.\nCamera: KEEP_CAMERA.\nFraming: KEEP_CROP.\nMicro-details: Fabric texture and pendant reflections.';
Object.assign(ctx, {
  OUTFITS: [tank, corset], PEINADOS: [], DETAILS: [], localStorage: { getItem: () => null },
  textoBase: () => ficha, getEditedPrompt: () => null,
  currentStyleId: 'original', currentOutfitId: 'tank', currentHairId: 'none', currentFormatId: '16-9',
  activeDetailIds: [], currentFigure: { bust: 'exaggerated' },
  ajustesPersonas: { duo: [{ figure: { armhole: 'wide' } }, { figure: { bust: 'very-large' } }], trio: [{}, {}, {}] },
  estiloPara: (_c, s) => s, prendaPara: (_s, p) => p, _canAccessTier: () => true,
  applyStylePrefix: t => t, applyHairInstruction: t => t, applyDetailsInstruction: t => t,
  applyFormatInstruction: t => t + '\n16:9', aplicarMedioArtistico: t => t, cat: {},
});
vm.runInContext(html.slice(html.indexOf('function obtenerPrenda('), html.indexOf('// Los peinados llegan')), ctx);
vm.runInContext(html.slice(html.indexOf('function leerFigura()'), html.indexOf('const TIPOS_PRENDA=')), ctx);
ctx.applyOutfitInstruction = (t, id, nombres) => ctx.cambiarPrenda(t, id, nombres);
vm.runInContext(html.slice(html.indexOf('    function textoFinal('), html.indexOf('    /** Copia con')), ctx);
for (const modo of ['solo', 'duo', 'trio']) {
  const nombres = ['Ensayo A', 'Ensayo B', 'Ensayo C'].slice(0, modo === 'solo' ? 1 : modo === 'duo' ? 2 : 3);
  const antes = JSON.stringify({ figure: ctx.currentFigure, people: ctx.ajustesPersonas });
  const directa = ctx.textoFinal(modo, nombres), base = ctx.textoFinal(modo, nombres, { sinFisico: true });
  assert.ok(/increase in bust volume/.test(directa));
  assert.ok(!/increase in bust volume|Selected figure|Figure and garment cut/.test(base));
  for (const token of ['KEEP_POSE', 'KEEP_HAIR', 'KEEP_CAMERA', 'KEEP_CROP', 'opaque ribbed cotton', '16:9']) assert.ok(base.includes(token));
  assert.equal(JSON.stringify({ figure: ctx.currentFigure, people: ctx.ajustesPersonas }), antes, 'Copiar base no borra los ajustes guardados');
  assert.equal(ctx.textoFinal(modo, nombres), directa, 'La copia habitual conserva su comportamiento');
}
console.log('OK imagen base Solo/Dúo/Trío: omite Físico común e individual sin borrar preferencias ni cambiar la copia habitual');

// DOM pequeño para comprobar los eventos reales de la ayuda plegable.
function nodo(tag) {
  const eventos = new Map();
  return { tagName: tag, children: [], value: '', open: false, attributes: {},
    appendChild(n) { this.children.push(n); return n; },
    setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(k, fn) { if (!eventos.has(k)) eventos.set(k, []); eventos.get(k).push(fn); },
    emitir(k) { for (const fn of eventos.get(k) || []) fn(); },
  };
}
let creados = 0, copiasBase = 0, abiertoFisico = 0, copiado = '';
ctx.document = { createElement: tag => { creados++; return nodo(tag); } };
let datos = { modo: 'duo', personas: [persona({ bust: 'large' }), persona({}, 'Ensayo B')], destino: 'all', destinoNombre: 'todas las personas', resumen: 'Grande' };
const host = nodo('div');
const vista = api.montar(host, { leer: () => datos, copiarBase: () => copiasBase++, elegirFisico: () => abiertoFisico++, copiarSegundo: t => { copiado = t; } });
assert.equal(creados, 2, 'La escena sólo construye details y summary al inicio');
const detalles = host.children[0]; detalles.open = true; detalles.emitir('toggle');
const contenido = detalles.children[1], cantidad = creados;
const boton = text => contenido.children.find(n => n.tagName === 'button' && n.textContent === text);
const select = contenido.children.find(n => n.className === 'second-view').children[0];
const preview = contenido.children.find(n => n.tagName === 'textarea');
boton('Copiar imagen base').emitir('click'); assert.equal(copiasBase, 1);
boton('Elegir ajustes de Físico').emitir('click'); assert.equal(abiertoFisico, 1);
select.value = 'perfil'; select.emitir('change');
boton('Copiar segundo prompt').emitir('click'); assert.equal(copiado, preview.value); assert.ok(copiado.includes('gira el torso de perfil'));
datos = { ...datos, destino: '1', destinoNombre: 'Persona 2' }; vista.actualizar();
assert.equal(select.value, 'original', 'Cambiar de destino no activa una pose elegida para otro destino');
select.value = 'perfil'; select.emitir('change');
assert.ok(preview.value.includes('Persona 2 ("Ensayo B"): gira'));
datos = { ...datos, modo: 'solo', personas: [persona()], destino: 'all' }; vista.actualizar();
assert.equal(select.value, 'original', 'Cambiar a Solo no hereda la vista del Dúo');
datos.personas[0].nombre = 'Ensayo <img src=x onerror=alert(1)> $&'; datos.personas[0].figure = { bust: 'large' }; vista.actualizar();
assert.ok(preview.value.includes('Ensayo <img src=x onerror=alert(1)> $&'), 'Los nombres permanecen como texto en la vista previa');
detalles.open = false; detalles.emitir('toggle'); detalles.open = true; detalles.emitir('toggle');
assert.equal(creados, cantidad, 'Reabrir reutiliza los controles');
assert.equal(preview.readOnly, true);
console.log('OK ayuda plegable: construcción diferida, copia de la vista previa, cambios frescos y poses separadas por modo/destino');
