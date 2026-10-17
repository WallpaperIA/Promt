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
  window:{},Event,Set,accordionArmado:true,requestAnimationFrame:fn=>{cuadros.set(++siguiente,fn);return siguiente;},cancelAnimationFrame:id=>cuadros.delete(id),
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

// Ejecutar los cinco constructores reales con las listas públicas. El DOM
// mínimo conserva clases, hijos y eventos; no necesita cuerpos de prompts.
function elementoAjuste(){
  const e=nodo(),clases=new Set(),atributos={};
  Object.defineProperty(e,'className',{get:()=>[...clases].join(' '),set:s=>{clases.clear();s.split(/\s+/).filter(Boolean).forEach(c=>clases.add(c));}});
  e.classList={add:c=>clases.add(c),remove:c=>clases.delete(c),contains:c=>clases.has(c),toggle(c,on){if(on??!clases.has(c))clases.add(c);else clases.delete(c);}};
  e.setAttribute=(k,v)=>{atributos[k]=v;};e.getAttribute=k=>atributos[k]??null;
  e.appendChild=n=>{e.children.push(n);n.parentElement=e;return n;};
  e.prepend=n=>{e.children.unshift(n);n.parentElement=e;};
  e.remove=()=>{if(e.parentElement)e.parentElement.children=e.parentElement.children.filter(n=>n!==e);};
  e.matches=s=>{const m=s.match(/^\.([\w-]+)(?:\[data-([\w-]+)\])?$/);return !!m&&clases.has(m[1])&&(!m[2]||Object.hasOwn(e.dataset,m[2]));};
  e.querySelectorAll=s=>e.children.flatMap(n=>[...(n.matches?.(s)?[n]:[]),...(n.querySelectorAll?.(s)||[])]);
  e.querySelector=s=>e.querySelectorAll(s)[0]||null;
  return e;
}
function probarAjustes(full=true,prendaGuardada='lined-lace-bodysuit'){
  let creados=0,busquedas=0,previews=0;
  const crear=()=>{creados++;return elementoAjuste();};
  const sec=crear(),nombre=crear();nombre.className='sec-name';sec.appendChild(nombre);
  const botones=Object.fromEntries(['Style','Outfit','Hair','Format','Extras','Edit'].map(n=>{
    const b=crear(),valor=crear();valor.className='mode-valor';b.appendChild(valor);return ['btn'+n,b];
  }));
  const datos=new Map([['style','playboy'],['outfit',prendaGuardada],['hair','semi-alto-volumen'],['format','16-9']]);
  const ctx=vm.createContext({
    ...botones,sec,cat:{id:'sintetica',tier:'editorial'},editPanel:crear(),botonesAjuste:Object.values(botones),
    document:{createElement:crear},localStorage:{getItem:k=>datos.get(k)??null,setItem:(k,v)=>datos.set(k,v),removeItem:k=>datos.delete(k)},
    KEY_STYLE:'style',KEY_OUTFIT:'outfit',KEY_HAIR:'hair',KEY_FORMAT:'format',KEY_DETAILS:'details',
    _canAccessTier:t=>full||t==='free',_esc:s=>s,icon:()=>'',showToast(){},
    makeActivatable:(e,n)=>e.setAttribute('aria-label',n),buscarOpcionesAjuste:()=>busquedas++,
    editModes:[],getEditedPrompt:()=>null,pintarNotaPrivada(){},pintarPreview:()=>previews++,cargarEdicion(){},
  });
  const helper=html.match(/function prepararPanelUnaVez\(construir\)\{[\s\S]*?\n\}/)?.[0];assert.ok(helper);
  vm.runInContext(readFileSync(new URL('../data/modificadores.js',import.meta.url),'utf8')
    +'\nObject.assign(globalThis,WP_MODIFICADORES);\n'+extraer(html,'if(globalThis.WP_MODIFICADORES){','// ── Mis personajes')+'\nconst PEINADOS=HAIRSTYLES;\n'
    +extraer(html,'const TIERS_ILUSTRACION=', 'const KEY_FORMAT')+'\n'+helper+'\n'
    +extraer(html,'    // Style panel','    // Upgrade CTA')
    +'\nthis.ajustes={stylePanel,outfitPanel,hairPanel,formatPanel,detailsPanel,styleGrid,outfitGrid,hairGrid,formatGrid};',ctx);
  return {...ctx.ajustes,botones,datos,ctx,creados:()=>creados,busquedas:()=>busquedas,previews:()=>previews};
}
const ajustes=probarAjustes();
const contar=a=>['stylePanel','outfitPanel','hairPanel','formatPanel','detailsPanel'].reduce((n,k)=>n+a[k].querySelectorAll('.style-card').length+a[k].querySelectorAll('.outfit-card').length+a[k].querySelectorAll('.format-card').length+a[k].querySelectorAll('.detail-chip').length,0);
assert.equal(contar(ajustes),0,'Abrir la escena no construye opciones de paneles cerrados');
ajustes.botones.btnOutfit.click();
assert.equal(ajustes.outfitGrid.children.filter(n=>n.matches('.outfit-card')).length,58);
assert.equal(ajustes.busquedas(),1);
assert.equal(ajustes.outfitGrid.querySelector('.selected').dataset.id,'lined-lace-bodysuit');
const primeraPrenda=ajustes.outfitGrid.querySelector('.outfit-card'),creadosAntes=ajustes.creados();
ajustes.botones.btnOutfit.click();ajustes.botones.btnOutfit.click();
assert.equal(ajustes.creados(),creadosAntes,'Cerrar y volver a abrir conserva el panel y sus controles');
assert.equal(ajustes.outfitGrid.querySelector('.outfit-card'),primeraPrenda);
// Elegir cada prenda ejecuta su handler real y aplica su nota al texto de
// prueba. Se conservan los centinelas de Solo, Dúo y Trío sin tocar la escena.
const prendas=vm.runInContext('OUTFITS.filter(o=>o.id!=="none")',ajustes.ctx);
const baseSintetica='MARCADOR SINTÉTICO __N__ / __N1__ / __N2__ / __N3__. 16:9 4K.';
ajustes.ctx.baseSintetica=baseSintetica;
for(const prenda of prendas){
  const tarjeta=ajustes.outfitGrid.querySelectorAll('.outfit-card').find(n=>n.dataset.id===prenda.id);
  assert.ok(tarjeta,'Tarjeta disponible: '+prenda.id);tarjeta.click();
  assert.equal(ajustes.datos.get('outfit'),prenda.id);
  assert.equal(ajustes.outfitGrid.querySelector('.selected').dataset.id,prenda.id);
  const aplicado=vm.runInContext('applyOutfitInstruction(baseSintetica,currentOutfitId)',ajustes.ctx);
  assert.ok(aplicado.startsWith(baseSintetica),'Conserva el texto de la escena: '+prenda.id);
  assert.ok(aplicado.includes(prenda.instruction),'La nota corresponde a la elección: '+prenda.id);
}
console.log('OK las 57 prendas se eligen desde sus tarjetas y aplican la nota correcta conservando los centinelas');
ajustes.botones.btnHair.click();assert.equal(ajustes.hairGrid.querySelectorAll('.outfit-card').length,20);
const peloOriginal=ajustes.hairGrid.querySelectorAll('.outfit-card').find(n=>n.getAttribute('aria-label')==='Peinado Original');
peloOriginal.click();assert.equal(ajustes.datos.get('hair'),'none');
ajustes.botones.btnFormat.click();assert.equal(ajustes.formatGrid.querySelectorAll('.format-card').length,6);
ajustes.formatGrid.querySelectorAll('.format-card').at(-1).click();assert.notEqual(ajustes.datos.get('format'),'16-9');
ajustes.botones.btnExtras.click();assert.equal(ajustes.detailsPanel.querySelectorAll('.detail-chip').length,37);
const detalles=vm.runInContext('DETAILS',ajustes.ctx),primero=detalles.find(d=>d.excl&&detalles.some(o=>o.id!==d.id&&o.excl===d.excl));
const segundo=detalles.find(d=>d.id!==primero.id&&d.excl===primero.excl);
const chip=id=>ajustes.detailsPanel.querySelectorAll('.detail-chip').find(n=>n.dataset.id===id);
chip(primero.id).click();chip(segundo.id).click();
assert.equal(chip(primero.id).getAttribute('aria-pressed'),'false');assert.equal(chip(segundo.id).getAttribute('aria-pressed'),'true');
assert.deepEqual(JSON.parse(ajustes.datos.get('details')),[segundo.id]);
ajustes.detailsPanel.querySelector('.detail-clear-btn').click();assert.equal(ajustes.datos.has('details'),false);
ajustes.botones.btnStyle.click();assert.equal(ajustes.styleGrid.querySelectorAll('.style-card').length,20);
assert.equal(contar(ajustes),141,'Todas las opciones siguen disponibles al pedirlas');
const ilustracion=vm.runInContext('STYLES.find(s=>s.medium==="illustration")',ajustes.ctx);
ajustes.styleGrid.querySelectorAll('.style-card').find(n=>n.getAttribute('aria-label')==='Estilo '+ilustracion.name).click();
assert.equal(ajustes.outfitGrid.querySelector('.selected').dataset.id,'none');
assert.ok(ajustes.outfitGrid.querySelectorAll('.outfit-card[data-revela]').every(n=>n.getAttribute('aria-disabled')==='true'));
const diferida=probarAjustes();diferida.botones.btnStyle.click();
diferida.styleGrid.querySelectorAll('.style-card').find(n=>n.getAttribute('aria-label')==='Estilo '+ilustracion.name).click();
assert.equal(diferida.outfitGrid.children.length,0);
diferida.botones.btnOutfit.click();assert.equal(diferida.outfitGrid.querySelector('.selected').dataset.id,'none');
assert.ok(diferida.outfitGrid.querySelectorAll('.outfit-card[data-revela]').every(n=>n.getAttribute('aria-disabled')==='true'));
const gratis=probarAjustes(false);gratis.botones.btnOutfit.click();
for(const tarjeta of gratis.outfitGrid.querySelectorAll('.outfit-card').filter(n=>n.classList.contains('locked')))tarjeta.click();
assert.equal(gratis.outfitGrid.querySelector('.selected').dataset.id,'none');assert.equal(gratis.previews(),0);
const restaurada=probarAjustes(true,'voile-shirt-bodysuit');restaurada.botones.btnOutfit.click();
assert.equal(restaurada.outfitGrid.querySelector('.selected').dataset.id,'voile-shirt-bodysuit','Una prenda nueva guardada se restaura al abrir');
const retirada=probarAjustes(true,'tulle-panel-bodysuit');retirada.botones.btnOutfit.click();
assert.equal(retirada.outfitGrid.querySelector('.selected').dataset.id,'none','El selector muestra Original si la prenda guardada se retiró');
console.log('OK ajustes a pedido: 0 opciones iniciales, 141 disponibles, sin duplicados, elecciones, candados y límites de ilustración');

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
