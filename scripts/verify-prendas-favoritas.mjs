#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Ejecuta las funciones del HTML y las prendas públicas, sin cuentas ni
// cuerpos privados. El almacenamiento compartido reproduce otra visita.
const leer=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=leer('index.html');
const inicio=html.indexOf('function getOutfitFavs('), fin=html.indexOf('function getEdits(',inicio);
const inicioListas=html.indexOf('if(globalThis.WP_MODIFICADORES){'),finListas=html.indexOf('// ── Mis personajes',inicioListas);
const inicioBuscar=html.indexOf('function buscarOpcionesAjuste('), finBuscar=html.indexOf('\n}',inicioBuscar)+2;
assert.ok(inicio>=0 && fin>inicio && inicioBuscar>=0 && finBuscar>inicioBuscar);
const datos=new Map([['wp_outfit_v1','none'],['wp_favs_v1','["escena-sintetica"]']]);
const escrituras=[];
let sinEspacio=false;
function elemento(){
  const atributos={},eventos={},clases=new Set();
  return {hidden:false,value:'',textContent:'',dataset:{},children:[],atributos,eventos,
    classList:{toggle(c,on){if(on)clases.add(c);else clases.delete(c);},contains:c=>clases.has(c)},
    setAttribute(k,v){atributos[k]=v;},
    addEventListener(k,f){eventos[k]=f;},
    dispatchEvent(e){eventos[e.type]?.(e);},
    prepend(e){this.children.unshift(e);},append(e){this.children.push(e);},
  };
}
const botones=[],contadores=[],busquedas=[],oyentes={};
const storage={getItem:k=>datos.get(k)??null,setItem(k,v){if(sinEspacio)throw new Error('sin espacio');datos.set(k,v);escrituras.push(k);}};
function entorno(){
  const contexto=vm.createContext({
    localStorage:storage,KEY_OUTFIT_FAVS:'wp_outfit_favs_v1',Set,Event,
    sinTildes:t=>t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),
    icon:n=>'<svg data-icon="'+n+'"></svg>',
    document:{createElement:elemento,querySelectorAll:s=>s==='.outfit-favorite-btn'?botones:s==='.outfit-favs-count'?contadores:busquedas},
    window:{addEventListener:(k,f)=>{oyentes[k]=f;}},
  });
  vm.runInContext(leer('data/modificadores.js')+'\nObject.assign(globalThis,WP_MODIFICADORES);\n'+leer('data/prendas-filtros.js')+'\n'+html.slice(inicioListas,finListas)+'\n'+html.slice(inicio,fin)+'\n'+html.slice(inicioBuscar,finBuscar),contexto);
  return contexto;
}
const app=entorno();
const activas=JSON.parse(vm.runInContext('JSON.stringify(OUTFITS)',app));
const fichas=JSON.parse(JSON.stringify(app.WP_PRENDAS_FILTROS));
const origen=vm.createContext({});
vm.runInContext(leer('data/modificadores.js'),origen);
const originales=JSON.parse(vm.runInContext('JSON.stringify(OUTFITS)',origen));
const tipos=new Set(['body','camisola','conjunto','vestido','camisa','top','bano','otros','original']);
const telas=new Set(['algodon','lino','denim','punto','seda-saten','gasa-voile','tul','red-malla','encaje','elastico','otros']);
assert.equal(activas.length,58);
assert.equal(Object.keys(fichas).length,activas.length);
assert.ok(!/instruction|prompt|prefix|suffix/.test(leer('data/prendas-filtros.js')));
for(const prenda of activas){
  const ficha=fichas[prenda.id];
  assert.deepEqual(Object.keys(ficha).sort(),['fabrics','family']);
  assert.ok(tipos.has(ficha.family));
  assert.ok(Array.isArray(ficha.fabrics));
  assert.equal(new Set(ficha.fabrics).size,ficha.fabrics.length);
  for(const tela of ficha.fabrics)assert.ok(telas.has(tela));
  if(!['none','nothing'].includes(prenda.id))assert.ok(ficha.fabrics.length);
  const {family,fabrics,...sinClasificacion}=prenda;
  assert.equal(family,ficha.family);assert.deepEqual(fabrics,ficha.fabrics);
  assert.deepEqual(sinClasificacion,originales.find(o=>o.id===prenda.id),'La clasificación conserva todos los datos anteriores');
}
const {construirSitio}=await import('./build-site.mjs');
await construirSitio(fileURLToPath(new URL('../build/site',import.meta.url)));
assert.equal(leer('build/site/data/prendas-filtros.js'),leer('data/prendas-filtros.js'));
console.log('OK clasificación de las 58 opciones, sin alterar datos anteriores ni copiar sus notas');
assert.equal(app.getOutfitFavs().size,0);
assert.equal(app.setOutfitFavorite('linen-shirt-shorts',true),true);
assert.equal(app.setOutfitFavorite('voile-shirt-bodysuit',true),true);
assert.equal(app.setOutfitFavorite('linen-shirt-shorts',true),true);
assert.equal(app.getOutfitFavs().size,2);
assert.deepEqual([...entorno().getOutfitFavs()],['linen-shirt-shorts','voile-shirt-bodysuit']);
assert.equal(datos.get('wp_outfit_v1'),'none');
assert.equal(datos.get('wp_favs_v1'),'["escena-sintetica"]');
assert.ok(escrituras.every(k=>k==='wp_outfit_favs_v1'));
assert.equal(app.setOutfitFavorite('none',true),false);
assert.equal(app.setOutfitFavorite('id-que-no-existe',true),false);
assert.equal(app.setOutfitFavorite('tulle-panel-bodysuit',true),false,'No reaparece una prenda retirada');
assert.equal(app.setOutfitFavorite('linen-shirt-shorts',false),true);
assert.deepEqual([...app.getOutfitFavs()],['voile-shirt-bodysuit']);
console.log('OK favoritas únicas y persistentes, independientes de escena, selección y favoritas del catálogo');

for(const invalido of ['null','{}','"texto"','no-json','[12,null,"none","id-retirado"]']){
  datos.set('wp_outfit_favs_v1',invalido);
  assert.equal(app.getOutfitFavs().size,0);
}
datos.set('wp_outfit_favs_v1','["linen-shirt-shorts","linen-shirt-shorts","none"]');
assert.deepEqual([...app.getOutfitFavs()],['linen-shirt-shorts']);
sinEspacio=true;
assert.equal(app.setOutfitFavorite('voile-shirt-bodysuit',true),false);
assert.deepEqual([...app.getOutfitFavs()],['linen-shirt-shorts']);
sinEspacio=false;
console.log('OK datos malformados, IDs retirados, Original y fallos de almacenamiento no crean falsas favoritas');

const b=elemento();b.dataset.outfitId='linen-shirt-shorts';
app.pintarFavoritaPrenda(b,app.getOutfitFavs());
assert.equal(b.atributos['aria-pressed'],'true');
assert.equal(b.atributos['aria-label'],'Quitar Camisa de lino de favoritas');
assert.ok(b.innerHTML.includes('heart-fill'));
app.setOutfitFavorite('linen-shirt-shorts',false);
app.pintarFavoritaPrenda(b,app.getOutfitFavs());
assert.equal(b.atributos['aria-pressed'],'false');
assert.equal(b.atributos['aria-label'],'Añadir Camisa de lino a favoritas');
console.log('OK estado y nombre accesible del corazón al añadir y quitar');

let soloFavoritas=false;
const tarjetas=[['linen-shirt-shorts','Camisa de lino'],['voile-shirt-bodysuit','Body camisero de voile'],['none','Original']].map(([id,t])=>({...elemento(),dataset:{id},textContent:t,matches:s=>s==='.outfit-option'}));
const etiquetas=[{...elemento(),nextElementSibling:tarjetas[0]},{...elemento(),nextElementSibling:tarjetas[1]}].map(e=>({...e,matches:s=>s==='.tier-section-label'}));
tarjetas[0].nextElementSibling=etiquetas[1];tarjetas[1].nextElementSibling=tarjetas[2];
const panel={...elemento(),querySelectorAll:s=>s==='.outfit-option'?tarjetas:etiquetas};
const busqueda=app.buscarOpcionesAjuste(panel,'.outfit-option','prendas',(cards,q,vacio)=>app.filtrarPrendas(cards,{favoritas:soloFavoritas},vacio));
const vacio=panel.children.at(-1),visibles=()=>tarjetas.filter(c=>!c.hidden).map(c=>c.dataset.id);
app.setOutfitFavorite('linen-shirt-shorts',true);
app.setOutfitFavorite('voile-shirt-bodysuit',true);
busqueda.filtrar();assert.equal(visibles().length,3);
soloFavoritas=true;busqueda.filtrar();assert.deepEqual(visibles(),['linen-shirt-shorts','voile-shirt-bodysuit']);
busqueda.entrada.value='VOÍLE';busqueda.entrada.eventos.input();
assert.deepEqual(visibles(),['voile-shirt-bodysuit']);
assert.equal(etiquetas[0].hidden,true);assert.equal(etiquetas[1].hidden,false);
busqueda.entrada.value='nada';busqueda.filtrar();assert.equal(vacio.hidden,false);
assert.equal(vacio.textContent,'No hay prendas favoritas con estos filtros.');
busqueda.entrada.value='';app.setOutfitFavorite('linen-shirt-shorts',false);app.setOutfitFavorite('voile-shirt-bodysuit',false);busqueda.filtrar();
assert.equal(visibles().length,0);assert.ok(vacio.textContent.includes('Todavía no tenés prendas favoritas'));
soloFavoritas=false;busqueda.filtrar();assert.equal(visibles().length,3);assert.equal(vacio.hidden,true);
console.log('OK búsqueda y favoritas juntas, acentos, grupos sin resultados y lista vacía recuperable');

const otro=elemento();otro.dataset.outfitId='linen-shirt-shorts';botones.push(b,otro);
const cuenta=elemento();contadores.push(cuenta);busquedas.push(busqueda.entrada);
app.setOutfitFavorite('linen-shirt-shorts',true);
oyentes.storage({key:'wp_outfit_favs_v1'});
assert.equal(b.atributos['aria-pressed'],'true');assert.equal(otro.atributos['aria-pressed'],'true');assert.equal(cuenta.textContent,1);
datos.delete('wp_outfit_favs_v1');oyentes.storage({key:null});
assert.equal(b.atributos['aria-pressed'],'false');assert.equal(cuenta.textContent,0);
console.log('OK selectores abiertos y cambios de otra pestaña se actualizan sin modificar el prompt');
