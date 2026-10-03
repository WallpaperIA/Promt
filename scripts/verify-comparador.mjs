#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Se prueba la función que usa la página, sin otra implementación que pueda
// divergir. Reconstruir los dos textos detecta pérdidas de marcadores o espacios.
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const a=html.indexOf('function diferenciasPlantillas('),b=html.indexOf('\nconst comparador=',a);
assert(a>=0&&b>a);
const c=vm.createContext({});new vm.Script(html.slice(a,b)+';globalThis.diff=diferenciasPlantillas;').runInContext(c);
const casos=[
  ['', ''],['igual\n__N__','igual\n__N__'],['','Agregado __N__'],['Quitado __N__',''],
  ['Luz suave sobre __N__.','Luz dramática sobre __N__.'],
  ['__N1__ y __N2__\nPose: brazos abajo.','__N1__ y __N2__\nPose: brazos arriba.'],
  ['a b a b c','b a c a b'],['Ana $1 & <b>texto</b>','Ana $& & <img src=x>'],
  ['  línéa\n\notra\tfin ','  línéa\notra\tfin.'],
  ['á😀!? __N3_HAIR__','á😀! __N3_FEATURES__'],
  ['a '.repeat(1800),'b '.repeat(1800)],
];
for(const [original,edicion] of casos){
  const d=c.diff(original,edicion);
  assert.equal(d.bloques.filter(b=>b.tipo!=='agregado').map(b=>b.texto).join(''),original);
  assert.equal(d.bloques.filter(b=>b.tipo!=='quitado').map(b=>b.texto).join(''),edicion);
  if(original===edicion)assert(d.bloques.every(b=>b.tipo==='igual'));
}
assert(c.diff('a '.repeat(1800),'b '.repeat(1800)).amplio);
console.log(casos.length+' casos de comparación preservan ambos textos exactos.');
