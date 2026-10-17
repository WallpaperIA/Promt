#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';

// Sólo metadata pública y fixtures. Se ejecutan las funciones reales del
// HTML, incluyendo los eventos: no se duplican las reglas del buscador.
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extraer(fuente,inicio,fin){
  const a=fuente.indexOf(inicio), b=fuente.indexOf(fin,a);
  assert.ok(a>=0 && b>a,`No se encontró ${inicio}`);
  return fuente.slice(a,b);
}
function buscador(fuente){
  const contexto=vm.createContext({});
  vm.runInContext(extraer(fuente,'function sinTildes(t){',"searchInput.addEventListener('input'")
    +extraer(fuente,'const EQUIVALENCIAS_BUSQUEDA=',"document.getElementById('resultados-limpiar')")
    + '\nlet normalizaciones=0; const normalizarOriginal=sinTildes; sinTildes=t=>{normalizaciones++;return normalizarOriginal(t);};',contexto);
  return {coincide:contexto.coincideBusqueda,cuenta:()=>vm.runInContext('normalizaciones',contexto)};
}
const filas=[
  {id:'beach-wet-dress',name:'Beach Wet Dress · Sunset',tier:'editorial'},
  {id:'banera-velas',name:'Bañera con Velas',tier:'xxx'},
  {id:'window-shirt',name:'Camisa de lino · Luz de ventana',tier:'casual'},
  {id:'forest-portrait',name:'Retrato del Bosque',tier:'editorial'},
  {id:'piscina-azul',name:'Piscina Azul',tier:'hot'},
].map(dataset=>({dataset:{...dataset},style:{}}));
const busca=buscador(html), ids=q=>filas.filter(w=>busca.coincide(w,q)).map(w=>w.dataset.id);
for(const [consulta,esperadas] of [
  ['playa vestido',['beach-wet-dress']],['atardecer',['beach-wet-dress']],
  ['BAÑERA',['banera-velas']],['banera',['banera-velas']],
  ['retrato luz ventana',['window-shirt']],['camisa',['window-shirt']],
  ['bosque',['forest-portrait']],['pool',['piscina-azul']],
  ['para celular',filas.map(w=>w.dataset.id)],['',filas.map(w=>w.dataset.id)],['zzzz',[]],
]) assert.deepEqual(ids(consulta),esperadas,consulta);
const editada={dataset:{id:'estudio',name:'Estudio'},style:{}};
assert.equal(busca.coincide(editada,'estudio'),true);
editada.dataset.name='Terraza'; editada.dataset.id='terraza';
assert.equal(busca.coincide(editada,'estudio'),false,'La metadata anterior no queda en el índice');
assert.equal(busca.coincide(editada,'terraza'),true);
console.log('OK búsqueda: tildes, equivalencias, varias palabras, formato móvil y cambios de metadata');

function nodo(dataset={}){
  const eventos=new Map(), clases=new Set();
  return {dataset,style:{},hidden:false,value:'',textContent:'',children:[],
    classList:{add:c=>clases.add(c),remove:c=>clases.delete(c),toggle(c,on){if(on)clases.add(c);else clases.delete(c);}},
    addEventListener(tipo,fn){if(!eventos.has(tipo))eventos.set(tipo,[]);eventos.get(tipo).push(fn);},
    dispatchEvent(e){for(const fn of eventos.get(e.type)||[])fn(e);},
    click(){this.dispatchEvent({type:'click'});},focus(){},
    replaceChildren(...hijos){this.children=hijos;},append(hijo){this.children.push(hijo);},
  };
}
const elementos=new Map(['search','search-clear','no-results','resultados-limpiar','resultados-todas','busqueda-pista','busqueda-sugerencias'].map(id=>[id,nodo()]));
const mensajes=new Map();
elementos.get('no-results').querySelector=s=>{if(!mensajes.has(s))mensajes.set(s,nodo());return mensajes.get(s);};
const botones=['all','gratis','fav','casual','editorial','hot','xxx'].map(filter=>nodo({filter}));
let recorridos=0, avisos=0, favoritos=['window-shirt'], siguiente=0, avisarFiltros=()=>{};
const cuadros=new Map();
const contexto=vm.createContext({
  window:{},Event,Set,requestAnimationFrame:fn=>{cuadros.set(++siguiente,fn);return siguiente;},cancelAnimationFrame:id=>cuadros.delete(id),
  getFavs:()=>favoritos,showToast(){},
  document:{
    getElementById:id=>elementos.get(id),createElement:()=>nodo(),
    querySelectorAll:s=>s==='.filter-btn'?botones:(recorridos++,filas),
    querySelector:s=>botones.find(b=>s.includes('"'+b.dataset.filter+'"')),
    dispatchEvent:e=>{assert.equal(e.type,'wp-filtros-actualizados');avisos++;avisarFiltros();},
  },
});
vm.runInContext("window.__gratis=new Set(['beach-wet-dress']);\n"+extraer(html,'const searchInput=', '// ── Stats'),contexto);
const campo=elementos.get('search');
const escribir=texto=>{campo.value=texto;campo.dispatchEvent({type:'input'});};
const visibles=()=>filas.filter(w=>w.style.display!=='none').map(w=>w.dataset.id);
function dibujar(){const pendientes=[...cuadros.values()];cuadros.clear();for(const fn of pendientes)fn();}
for(const letra of ['v','ve','ven','vent','venta','ventan','ventana']) escribir(letra);
assert.equal(recorridos,0,'Las pulsaciones previas al dibujo no recorren todo el catálogo');
assert.equal(cuadros.size,1);
dibujar();
assert.equal(recorridos,1);assert.equal(avisos,1);
assert.deepEqual(visibles(),['window-shirt']);
escribir('playa');botones.find(b=>b.dataset.filter==='fav').click();
assert.equal(cuadros.size,0,'Cambiar de filtro cancela el trabajo pendiente');
assert.deepEqual(visibles(),[]);
elementos.get('search-clear').click();
assert.deepEqual(visibles(),['window-shirt'],'Limpiar conserva el filtro de favoritas');
favoritos=['forest-portrait'];botones.find(b=>b.dataset.filter==='fav').click();
assert.deepEqual(visibles(),['forest-portrait'],'Se leen las favoritas actuales');
botones.find(b=>b.dataset.filter==='gratis').click();
assert.deepEqual(visibles(),['beach-wet-dress']);
botones.find(b=>b.dataset.filter==='editorial').click();
escribir('playaa');dibujar();
assert.equal(elementos.get('no-results').style.display,'block');
const sugerencia=elementos.get('busqueda-sugerencias').children.find(b=>b.textContent==='Playa');
assert.ok(sugerencia,'Las sugerencias tienen coincidencias dentro del filtro');
sugerencia.click();dibujar();
assert.deepEqual(visibles(),['beach-wet-dress']);
escribir('bosque');elementos.get('search-clear').click();dibujar();
assert.deepEqual(visibles(),['beach-wet-dress','forest-portrait'],'Una búsqueda cancelada no reaparece después de limpiar');
// La grilla se entera al terminar el filtro, incluso si una foto ya había
// pedido un dibujo. El evento input sólo se ocupa de cerrar el detalle.
const inicioVista=html.indexOf("const grilla=document.getElementById('catalogo-grilla')");
const oyente=extraer(html.slice(inicioVista),"  searchInput.addEventListener('input'",'  window.addEventListener(\'storage\'');
const eventosGrilla=new Map();let repintados=0,cerradas=0,grillaPendiente=false,renderizadas=[];
function programarGrilla(){
  if(grillaPendiente)return;grillaPendiente=true;
  cuadros.set(++siguiente,()=>{grillaPendiente=false;repintados++;renderizadas=visibles();});
}
const campoGrilla=nodo();
vm.runInNewContext(oyente,{
  searchInput:campoGrilla,searchClear:nodo(),visual:true,elegida:'escena',volver:()=>cerradas++,programar:programarGrilla,
  document:{addEventListener:(tipo,fn)=>eventosGrilla.set(tipo,fn)},
});
assert.ok(eventosGrilla.has('wp-filtros-actualizados'));
campoGrilla.dispatchEvent({type:'input'});assert.equal(cerradas,1);
avisarFiltros=eventosGrilla.get('wp-filtros-actualizados');
programarGrilla(); // Una foto pidió dibujar antes de la nueva búsqueda.
escribir('playa');dibujar();dibujar();
assert.equal(repintados,2);
assert.deepEqual(renderizadas,['beach-wet-dress'],'El último dibujo usa el filtro nuevo aunque hubiera uno ya pendiente');
console.log('OK pulsaciones agrupadas, limpieza inmediata, favoritas actuales, filtros, sugerencias y aviso a la grilla');

// Reconstrucción real con cuerpos sustituidos: una sola escritura al DOM
// y una lectura de preferencias para todas las cabeceras de esta pasada.
let lecturasStats=0,lecturasFavs=0,escrituras=0,filtrados=0,limpiezas=0;
const cabeceras=[],frag={appendChild:n=>cabeceras.push(n)},stats={estudio:3};
const rebuild=vm.createContext({
  _detached:true,clearDetail:()=>limpiezas++,getStats:()=>{lecturasStats++;return stats;},getFavs:()=>{lecturasFavs++;return ['estudio'];},
  window:{__destacadas:[{id:'estudio',url:'https://foto.invalid/ejemplo.jpg'}]},
  document:{createDocumentFragment:()=>frag},getSortedCategories:()=>filas,
  buildSection:(cat,idx,estado)=>({cat,idx,estado}),
  acc:{replaceChildren:f=>{assert.equal(f,frag);escrituras++;}},applyFilters:()=>filtrados++,
});
vm.runInContext(extraer(html,'function rebuildAccordion(){','// ── Swipe'),rebuild);
rebuild.rebuildAccordion();
assert.equal(lecturasStats,1);assert.equal(lecturasFavs,1);assert.equal(escrituras,1);assert.equal(filtrados,1);assert.equal(limpiezas,1);
assert.equal(cabeceras.length,filas.length);
for(const c of cabeceras){assert.equal(c.estado,cabeceras[0].estado);assert.equal(c.estado.stats,stats);assert.equal(c.estado.favs.has('estudio'),true);assert.equal(c.estado.fotos.get('estudio').url,'https://foto.invalid/ejemplo.jpg');}
// Ejecutar la cabecera real hasta los handlers: la marca y el contador usan
// el snapshot; un click posterior sigue leyendo preferencias al momento.
const cabecera=extraer(html,'function buildSection(cat, idx, estado){','  // Del');
const creado=[];let preferenciasVivas=['otra'],guardadas;
const cab=vm.createContext({
  document:{createElement:()=>{const n=nodo();n.setAttribute=(k,v)=>{n[k]=v;};creado.push(n);return n;}},
  sinTildes:s=>s,cleanName:s=>s,_esc:s=>s,icon:s=>s,ICONO_TIER:{},ponerFoto:(n,f)=>{n.foto=f;},
  candadosConocidos:()=>false,esGratisVisible:()=>false,
  getFavs:()=>preferenciasVivas,saveFavs:f=>{guardadas=f;},updateStats(){},applyFilters(){},
});
vm.runInContext(cabecera+'\nreturn {starBtn,info};\n}',cab);
const h=cab.buildSection({id:'estudio',name:'Estudio',tier:'editorial',sub:''},0,cabeceras[0].estado);
assert.equal(h.starBtn['aria-pressed'],'true');assert.ok(h.info.innerHTML.includes('×3'));
h.starBtn.dispatchEvent({type:'click',stopPropagation(){}});
assert.deepEqual(guardadas,['otra','estudio'],'Los eventos no usan favoritas viejas del snapshot');
console.log('OK reconstrucción en un fragmento, snapshot compartido y eventos con preferencias actuales');

// Comparación opcional contra un HTML anterior. Es un microbenchmark de
// búsqueda en Node, no una medición de carga, red o velocidad del teléfono.
const comparar=process.argv.indexOf('--comparar');
if(comparar>=0){
  assert.ok(process.argv[comparar+1],'Falta la ruta del HTML anterior');
  const anterior=buscador(readFileSync(process.argv[comparar+1],'utf8'));
  const actual=buscador(html),catalogo=vm.createContext({});
  vm.runInContext(readFileSync(new URL('../data/catalog.js',import.meta.url),'utf8')+'\nthis.metadata=CATEGORIES;',catalogo);
  const datos=Array.from({length:335},(_,i)=>{const c=catalogo.metadata[i%catalogo.metadata.length];return {dataset:{id:c.id+'-'+i,name:c.name+' '+c.sub}};});
  const consultas=Array.from({length:200},(_,i)=>['playa','ventana','atardecer','camisa','vestido','bosque','banera','cama','espejo','piscina','estudio','retrato luz ventana','para celular','nocturna','lluvia','urbano','zzzz','interior','golden dress','beach'][i%20]);
  function ejecutar(b){return consultas.map(q=>datos.flatMap((w,i)=>b.coincide(w,q)?[i]:[]));}
  const antes=ejecutar(anterior),despues=ejecutar(actual);
  assert.deepEqual(despues,antes,'Cada consulta debe devolver exactamente las mismas filas y orden');
  const conteos={antes:anterior.cuenta(),despues:actual.cuenta()};
  assert.equal(conteos.antes,2*datos.length*consultas.length);
  assert.equal(conteos.despues,datos.length+consultas.length);
  const medir=b=>{const tiempos=[];for(let i=0;i<5;i++){const inicio=performance.now();ejecutar(b);tiempos.push(performance.now()-inicio);}return Number(tiempos.sort((a,b)=>a-b)[2].toFixed(1));};
  console.log(JSON.stringify({prueba:'Búsqueda sintética en Node; no mide la carga de la app',filas:datos.length,consultas:consultas.length,normalizaciones:conteos,medianaMs:{antes:medir(anterior),despues:medir(actual)}},null,2));
}
