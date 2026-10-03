#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const leer=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fuente=leer('data/modificadores.js'),catalogo=leer('data/catalog.js'),html=leer('index.html');
const server=vm.createContext({});
new vm.Script(fuente+';globalThis.listas={STYLES,OUTFITS,HAIRSTYLES,FORMATS,DETAILS};').runInContext(server);
assert.deepEqual(Object.fromEntries(Object.entries(server.listas).map(([k,v])=>[k,v.length])),{STYLES:20,OUTFITS:39,HAIRSTYLES:19,FORMATS:6,DETAILS:37});
for(const [nombre,lista]of Object.entries(server.listas)){
  assert.equal(new Set(lista.map(x=>x.id)).size,lista.length,nombre+' tiene IDs repetidos');
  for(const x of lista){
    assert(/^[a-z0-9-]+$/.test(x.id));assert(typeof x.name==='string');
    if(nombre!=='DETAILS')assert(typeof x.desc==='string');
    assert(!/[\u{1F300}-\u{1FAFF}]/u.test(x.name+(x.desc||'')));
    if(x.tier)assert(['free','premium','full'].includes(x.tier));
    if(nombre==='STYLES')assert(x.prefix&&typeof x.prefix==='string');
  }
}
const browser=vm.createContext({document:{}});
new vm.Script(catalogo+';globalThis.antes=JSON.stringify({CATEGORIES,CATALOG_BUILT_AT});').runInContext(browser);
new vm.Script(fuente).runInContext(browser);
const inicio=html.indexOf('if(globalThis.WP_MODIFICADORES){'),fin=html.indexOf('// ── Mis personajes',inicio);
assert(inicio>=0&&fin>inicio);new vm.Script(html.slice(inicio,fin)).runInContext(browser);
new vm.Script('globalThis.despues=JSON.stringify({CATEGORIES,CATALOG_BUILT_AT});globalThis.total=STYLES.length;').runInContext(browser);
assert.equal(browser.antes,browser.despues);assert.equal(browser.total,20);
const a=html.indexOf('function aplicarMedioArtistico('),b=html.indexOf('\nconst KEY_FORMAT',a);
new vm.Script(html.slice(a,b)+';globalThis.aplicar=aplicarMedioArtistico;').runInContext(browser);
const original='Original de __N1__ y __N2__. 9:16 4K. Extras: visible skin pores.';
for(const estilo of server.listas.STYLES){
  const texto=browser.aplicar(original,estilo.id);
  assert(texto.startsWith(original));assert(texto.includes('__N1__')&&texto.includes('__N2__'));
  if(estilo.medium==='illustration')assert(texto.includes('overrides inherited photographic rendering instructions'));
  if(!estilo.instruction)assert.equal(texto,original);
}
const workflow=leer('.github/workflows/pages.yml');
assert(workflow.includes('cp data/modificadores.js _site/data/'));
assert(!/cp\s+(?:-r\s+)?data\/?\s/.test(workflow));
console.log('Modificadores: 32 opciones nuevas, IDs únicos, VM y navegador compatibles; catálogo y sello intactos.');
