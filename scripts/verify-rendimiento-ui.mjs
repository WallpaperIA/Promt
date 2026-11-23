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
  document:{createElement:()=>{const n=nodo();n.setAttribute=(k,v)=>{n[k]=v;};n.appendChild=h=>{n.children.push(h);return h;};n.append=(...hs)=>{n.children.push(...hs);};creado.push(n);return n;}},
  // Las filas clonan nodos ya armados en vez de interpretar HTML.
  iconoNodo:nombre=>({icono:nombre}),PLANTILLA_FILA:{flecha:{cloneNode:()=>nodo()}},TEXTO_TIER:{editorial:'Editorial'},
  sinTildes:s=>s,cleanName:s=>s,_esc:s=>s,icon:s=>s,ICONO_TIER:{},ponerFoto:(n,f)=>{n.foto=f;},
  candadosConocidos:()=>false,esGratisVisible:()=>false,
  getFavs:()=>preferenciasVivas,saveFavs:f=>{guardadas=f;},updateStats(){},applyFilters(){},
});
vm.runInContext(cabecera+'\nreturn {starBtn,info};\n}',cab);
const h=cab.buildSection({id:'estudio',name:'Estudio',tier:'editorial',sub:''},0,cabeceras[0].estado);
const textoDe=n=>typeof n==='string'?n:(n.textContent||'')+(n.children||[]).map(textoDe).join('');
assert.equal(h.starBtn['aria-pressed'],'true');assert.ok(textoDe(h.info).includes('Estudio×3'),'Nombre y contador salen del snapshot');
assert.equal(h.starBtn.children[0].icono,'star-fill');
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
  e.focus=()=>{e.recibioFoco=true;};
  e.appendChild=n=>{if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(c=>c!==n);e.children.push(n);n.parentElement=e;return n;};
  e.append=(...ns)=>ns.forEach(n=>e.appendChild(n));
  e.prepend=n=>{if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(c=>c!==n);e.children.unshift(n);n.parentElement=e;};
  e.insertBefore=(n,antes)=>{if(!antes)return e.appendChild(n);e.children.splice(e.children.indexOf(antes),0,n);n.parentElement=e;return n;};
  Object.defineProperty(e,'nextElementSibling',{get(){if(!e.parentElement)return null;return e.parentElement.children[e.parentElement.children.indexOf(e)+1]||null;}});
  Object.defineProperty(e,'options',{get(){return e.children.filter(n=>n.tagName==='option');}});
  let contenido='';
  Object.defineProperty(e,'textContent',{get:()=>contenido+e.children.map(n=>n.textContent||'').join(' '),set:v=>{contenido=String(v);}});
  Object.defineProperty(e,'innerHTML',{get:()=>contenido,set:v=>{contenido=String(v).replace(/<[^>]*>/g,' ');}});
  e.remove=()=>{if(e.parentElement)e.parentElement.children=e.parentElement.children.filter(n=>n!==e);};
  e.matches=s=>{if(/^[a-z]+$/.test(s))return e.tagName===s;const m=s.match(/^\.([\w-]+)(?:\[data-([\w-]+)\])?$/);return !!m&&clases.has(m[1])&&(!m[2]||Object.hasOwn(e.dataset,m[2]));};
  e.querySelectorAll=s=>e.children.flatMap(n=>[...(n.matches?.(s)?[n]:[]),...(n.querySelectorAll?.(s)||[])]);
  e.querySelector=s=>e.querySelectorAll(s)[0]||null;
  return e;
}
function probarAjustes(full=true,prendaGuardada='second-skin-bodysuit',tierEscena='editorial'){
  let creados=0,busquedas=0,previews=0;
  const fotosAbiertas=[];
  let planesAbiertos=0;
  const crear=(tag='div')=>{creados++;const e=elementoAjuste();e.tagName=tag;return e;};
  const sec=crear(),nombre=crear();nombre.className='sec-name';sec.appendChild(nombre);
  const botones=Object.fromEntries(['Style','Outfit','Fisico','Hair','Format','Extras','Edit'].map(n=>{
    const b=crear(),valor=crear();valor.className='mode-valor';b.appendChild(valor);return ['btn'+n,b];
  }));
  const datos=new Map([['style','playboy'],['outfit',prendaGuardada],['hair','semi-alto-volumen'],['format','16-9']]);
  const ctx=vm.createContext({
    ...botones,sec,cat:{id:'sintetica',tier:tierEscena},editPanel:crear(),botonesAjuste:Object.values(botones),
    destinoCaja:crear(),destinoSelect:crear('select'),modoActual:'solo',destinoAjuste:'all',listo:true,
    ajustesPersonas:{duo:[{},{}],trio:[{},{},{}]},nombresDePrueba:()=>['Ensayo A','Ensayo B','Ensayo C'],
    window:{addEventListener(){}},Event,document:{createElement:crear,querySelectorAll:s=>{const a=ctx.ajustes;if(!a)return [];if(s==='.outfit-panel:not(.hair-panel) .mods-search')return a.outfitPanel.querySelectorAll('.mods-search');return [a.stylePanel,a.outfitPanel,a.hairPanel,a.formatPanel,a.detailsPanel].flatMap(e=>e.querySelectorAll(s));}},localStorage:{getItem:k=>datos.get(k)??null,setItem:(k,v)=>datos.set(k,v),removeItem:k=>datos.delete(k)},
    KEY_PRENDA_PERSONAL:'wp_custom_outfit_v1',KEY_OUTFIT_FAVS:'wp_outfit_favs_v1',KEY_STYLE:'style',KEY_OUTFIT:'outfit',KEY_HAIR:'hair',KEY_FORMAT:'format',KEY_DETAILS:'details',
    KEY_PEOPLE:'people',KEY_FIGURE:'figure',textoBase:()=> 'Photo. Outfit: opaque soft cotton camisole with thin shoulder straps and a round neckline.',
    _canAccessTier:t=>full||t==='free',_esc:s=>s,icon:()=>'',showToast(){},
    ampliarEjemplo:(url,alt)=>fotosAbiertas.push({url,alt}),
    abrirPlanes:()=>planesAbiertos++,
    sinTildes:s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),makeActivatable:(e,n)=>e.setAttribute('aria-label',n),
    editModes:[],getEditedPrompt:()=>null,pintarNotaPrivada(){},pintarPreview:()=>previews++,cargarEdicion(){},
  });
  const helper=html.match(/function prepararPanelUnaVez\(construir\)\{[\s\S]*?\n\}/)?.[0];assert.ok(helper);
  vm.runInContext(readFileSync(new URL('../assets/fisico.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../assets/fisico-ui.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../data/prendas-filtros.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../data/modificadores.js',import.meta.url),'utf8')
    +'\nObject.assign(globalThis,WP_MODIFICADORES);\n'+extraer(html,'if(globalThis.WP_MODIFICADORES){','// ── Mis personajes')+'\nconst PEINADOS=HAIRSTYLES;\n'
    +extraer(html,'function estiloPara(', 'const KEY_FORMAT')+'\n'+helper+'\n'
    +extraer(html,'function leerFigura()', 'const TIPOS_PRENDA=')+'\n'
    +extraer(html,'function obtenerPrenda(', '// Los peinados llegan')+'\n'
    +extraer(html,'const TIPOS_PRENDA=', '// Las listas de ajustes')+'\n'
    +extraer(html,'function getOutfitFavs(', 'function getEdits(')+'\n'
    +extraer(html,'    // Style panel','    // Upgrade CTA')
    +'\nthis.ajustes={stylePanel,outfitPanel,hairPanel,formatPanel,detailsPanel,figurePanel,styleGrid,outfitGrid,hairGrid,formatGrid,destinoSelect,destinoCaja};',ctx);
  return {...ctx.ajustes,botones,datos,ctx,fotosAbiertas,planesAbiertos:()=>planesAbiertos,creados:()=>creados,busquedas:()=>busquedas,previews:()=>previews};
}
const ajustes=probarAjustes();
const fisico=probarAjustes(true,'tank-white');
assert.equal(fisico.figurePanel.children.length,0,'Físico no construye controles al abrir la escena');
fisico.botones.btnFisico.click();
const volumen=id=>fisico.figurePanel.querySelectorAll('.figure-choice').find(b=>b.dataset.value===id);
assert.equal(fisico.figurePanel.querySelectorAll('.figure-choice').length,4);
const grande=volumen('large'),cantidadFisico=fisico.creados();
fisico.botones.btnFisico.click();fisico.botones.btnFisico.click();
assert.equal(fisico.creados(),cantidadFisico,'Reabrir Físico reutiliza sus controles');
assert.equal(volumen('large'),grande);
grande.click();
assert.equal(JSON.parse(fisico.datos.get('figure')).bust,'large');
const sisaFisico=fisico.figurePanel.querySelectorAll('select').find(s=>s.getAttribute('aria-label')==='Sisa del físico');
assert.equal(sisaFisico.disabled,false);
sisaFisico.value='wide';sisaFisico.dispatchEvent({type:'change'});
assert.equal(JSON.parse(fisico.datos.get('figure')).armhole,'wide');
const ajusteRopa=fisico.figurePanel.querySelectorAll('select').find(s=>s.getAttribute('aria-label')==='Ajuste de la ropa del físico');
ajusteRopa.value='volume';ajusteRopa.dispatchEvent({type:'change'});
assert.equal(JSON.parse(fisico.datos.get('figure')).fit,'volume');
const restaurarTodas=probarAjustes(true,'tank-white');
restaurarTodas.ctx.modoActual='trio';vm.runInContext('refrescarDestino()',restaurarTodas.ctx);
restaurarTodas.destinoSelect.value='1';restaurarTodas.destinoSelect.dispatchEvent({type:'change'});
restaurarTodas.botones.btnFisico.click();
restaurarTodas.figurePanel.querySelectorAll('.figure-choice').find(b=>b.dataset.value==='large').click();
restaurarTodas.destinoSelect.value='all';restaurarTodas.destinoSelect.dispatchEvent({type:'change'});
const restablecerGrupo=restaurarTodas.figurePanel.querySelector('.figure-reset');
assert.equal(restablecerGrupo.disabled,false,'Restaurar todas está disponible si sólo hay ajustes individuales');
restablecerGrupo.click();
assert.equal(restablecerGrupo.disabled,false,'Restaurar sigue disponible aunque todo esté en Original');
assert.ok(JSON.parse(restaurarTodas.datos.get('people')).trio.every(p=>p.figure===undefined));
fisico.ctx.modoActual='trio';vm.runInContext('refrescarDestino()',fisico.ctx);
fisico.destinoSelect.value='1';fisico.destinoSelect.dispatchEvent({type:'change'});
volumen('exaggerated').click();
assert.equal(JSON.parse(fisico.datos.get('people')).trio[1].figure.bust,'exaggerated');
assert.equal(JSON.parse(fisico.datos.get('figure')).bust,'large');
ajusteRopa.value='snug';ajusteRopa.dispatchEvent({type:'change'});
assert.equal(JSON.parse(fisico.datos.get('people')).trio[1].figure.fit,'snug');
assert.equal(JSON.parse(fisico.datos.get('figure')).fit,'volume');
volumen('none').click();
assert.equal(JSON.parse(fisico.datos.get('people')).trio[1].figure.bust,'none','Original individual prevalece sobre un ajuste común');
fisico.destinoSelect.value='all';fisico.destinoSelect.dispatchEvent({type:'change'});
ajusteRopa.value='volume';ajusteRopa.dispatchEvent({type:'change'});
volumen('very-large').click();
assert.ok(JSON.parse(fisico.datos.get('people')).trio.every(p=>p.figure?.bust===undefined));
fisico.botones.btnOutfit.click();
fisico.outfitGrid.querySelectorAll('.outfit-card').find(b=>b.dataset.id==='disfraz-diablita-corset-rojo').click();
fisico.botones.btnFisico.click();
assert.equal(sisaFisico.disabled,false,'La sisa siempre se puede seleccionar, incluso con una prenda incompatible');
assert.equal(sisaFisico.value,'wide','La preferencia se conserva sin aplicarse');
assert.ok(fisico.figurePanel.querySelectorAll('select').every(s=>s.disabled===false),'Ningún selector de físico se bloquea por la prenda');
assert.ok(fisico.figurePanel.querySelectorAll('.figure-choice').every(b=>b.disabled===false));
sisaFisico.value='open';sisaFisico.dispatchEvent({type:'change'});
assert.equal(JSON.parse(fisico.datos.get('figure')).armhole,'open','La elección se puede cambiar desde la prenda incompatible');
assert.equal(volumen('very-large').disabled,false,'El volumen sigue disponible en el corsé opaco');
fisico.botones.btnOutfit.click();fisico.outfitGrid.querySelectorAll('.outfit-card').find(b=>b.dataset.id==='tank-white').click();fisico.botones.btnFisico.click();
assert.equal(sisaFisico.disabled,false);
assert.equal(sisaFisico.value,'open');
fisico.figurePanel.querySelector('.figure-reset').click();
assert.equal(fisico.datos.has('figure'),false);
assert.ok(JSON.parse(fisico.datos.get('people')).trio.every(p=>p.figure===undefined));
console.log('OK Físico a pedido, cuatro niveles, controles por persona, compatibilidad, preferencias conservadas y restablecimiento');
// Los mismos handlers de las tarjetas ahora pueden apuntar a cada persona.
const individual=probarAjustes();individual.ctx.modoActual='trio';
vm.runInContext('refrescarDestino()',individual.ctx);
assert.equal(individual.destinoSelect.options.length,4);
assert.equal(individual.destinoSelect.options[3].textContent,'Persona 3 · Ensayo C');
const apuntar=i=>{individual.destinoSelect.value=String(i);individual.destinoSelect.dispatchEvent({type:'change'});};
individual.botones.btnOutfit.click();apuntar(1);
const vestidoIndividual=individual.outfitGrid.querySelectorAll('.outfit-card').find(c=>c.dataset.id==='plumetis-tulle-minidress');
const fotoIndividual=vestidoIndividual.querySelector('img');
assert.ok(fotoIndividual);
vestidoIndividual.click();
assert.equal(JSON.parse(individual.datos.get('people')).trio[1].outfit,'plumetis-tulle-minidress');
assert.equal(individual.datos.get('outfit'),'second-skin-bodysuit','La elección individual no cambia el ajuste común');
assert.equal(JSON.parse(individual.datos.get('people')).trio[0].outfit,undefined);
apuntar(0);
assert.equal(vestidoIndividual.getAttribute('aria-pressed'),'false');
assert.equal(vestidoIndividual.querySelector('img'),fotoIndividual,'Las fotos se conservan al cambiar de persona');
individual.botones.btnHair.click();
const pelo=individual.hairGrid.querySelectorAll('.outfit-card').find(c=>c.dataset.id!=='none'&&c.dataset.id!=='semi-alto-volumen');pelo.click();
assert.equal(JSON.parse(individual.datos.get('people')).trio[0].hair,pelo.dataset.id);
apuntar(2);individual.botones.btnExtras.click();
individual.detailsPanel.querySelectorAll('.detail-chip').find(c=>c.dataset.id==='red-lips').click();
assert.deepEqual(JSON.parse(individual.datos.get('people')).trio[2].details,['red-lips']);
individual.detailsPanel.querySelectorAll('.detail-chip').find(c=>c.dataset.id==='bg-white').click();
assert.ok(JSON.parse(individual.datos.get('details')).includes('bg-white'),'El fondo sigue siendo de la escena');
const textoPersonas=vm.runInContext('aplicarAjustesPersonas("Pose: CONSERVAR_TRES_POSICIONES.\\nCamera: CONSERVAR_CAMARA.","trio",["Ensayo A","Ensayo B","Ensayo C"],{outfit:currentOutfitId,hair:currentHairId,details:activeDetailIds},ajustesPersonas)',individual.ctx);
assert.ok(textoPersonas.startsWith('Pose: CONSERVAR_TRES_POSICIONES.\nCamera: CONSERVAR_CAMARA.'));
const vestuario=textoPersonas.split('Wardrobe override:')[1].split('Individual adjustments:')[0];
const ropaPorPersona=new Map([...vestuario.matchAll(/Person ([123]) \(named "[^"]*"\) wears: ([\s\S]*?)(?=\nPerson [123]| This selected wardrobe|$)/g)].map(m=>[m[1],m[2]]));
assert.equal(ropaPorPersona.size,3);
const notaP2=vm.runInContext('descripcionDePrenda(OUTFITS.find(o=>o.id==="plumetis-tulle-minidress"))',individual.ctx);
const labios=vm.runInContext('DETAILS.find(d=>d.id==="red-lips").prompt',individual.ctx);
assert.ok(ropaPorPersona.get('2').includes(notaP2));assert.ok(!ropaPorPersona.get('1').includes(notaP2));assert.ok(!ropaPorPersona.get('3').includes(notaP2));
const ajustesTexto=textoPersonas.split('Individual adjustments:')[1];
const cambiosPorPersona=new Map([...ajustesTexto.matchAll(/Person ([123]) \(named "[^"]*"\):\n([\s\S]*?)(?=\n\nPerson |\n\nShared|$)/g)].map(m=>[m[1],m[2]]));
assert.ok(cambiosPorPersona.get('3').includes(labios));assert.ok(!cambiosPorPersona.get('1').includes(labios));assert.ok(!(cambiosPorPersona.get('2')||'').includes(labios));
assert.equal((textoPersonas.match(/Shared scene adjustments:/g)||[]).length,1);
apuntar('all');individual.outfitGrid.querySelectorAll('.outfit-card').find(c=>c.dataset.id==='none').click();
assert.ok(JSON.parse(individual.datos.get('people')).trio.every(p=>p.outfit===undefined),'Todas restablece el ajuste común de esa opción');
assert.equal(JSON.parse(individual.datos.get('people')).trio[0].hair,pelo.dataset.id,'Cambiar la prenda no borra los peinados');
individual.ctx.modoActual='duo';vm.runInContext('refrescarDestino()',individual.ctx);
assert.equal(individual.destinoSelect.options.length,3,'Dúo sólo ofrece dos personas');
console.log('OK Persona 1, 2 y 3: prendas, peinados y extras independientes; escena común, resumen y selección Todas');
const contar=a=>['stylePanel','outfitPanel','hairPanel','formatPanel','detailsPanel'].reduce((n,k)=>n+a[k].querySelectorAll('.style-card').length+a[k].querySelectorAll('.outfit-card').length+a[k].querySelectorAll('.format-card').length+a[k].querySelectorAll('.detail-chip').length,0);
assert.equal(contar(ajustes),0,'Abrir la escena no construye opciones de paneles cerrados');
assert.equal(ajustes.outfitGrid.querySelectorAll('img').length,0,'No hay miniaturas antes de abrir Prenda');
ajustes.botones.btnOutfit.click();
const totalPrendas=ajustes.outfitGrid.querySelectorAll('.outfit-card').length;
assert.equal(totalPrendas,87);
assert.equal(ajustes.outfitGrid.tagName,'ul');
assert.ok(ajustes.outfitGrid.querySelectorAll('.outfit-option').every(opcion=>opcion.tagName==='li'));
assert.equal(ajustes.outfitPanel.querySelectorAll('.mods-search').length,1);
assert.equal(ajustes.outfitGrid.querySelector('.selected').dataset.id,'second-skin-bodysuit');
const miniaturas=ajustes.outfitGrid.querySelectorAll('img');
assert.equal(miniaturas.length,84,'Las fotos aparecen junto a las prendas al abrir la lista');
assert.ok(miniaturas.every(img=>img.width===42&&img.height===42&&img.loading==='lazy'&&img.decoding==='async'));
const primeraPrenda=ajustes.outfitGrid.querySelector('.outfit-card'),creadosAntes=ajustes.creados();
ajustes.botones.btnOutfit.click();ajustes.botones.btnOutfit.click();
assert.equal(ajustes.creados(),creadosAntes,'Cerrar y volver a abrir conserva el panel y sus controles');
assert.equal(ajustes.outfitGrid.querySelector('.outfit-card'),primeraPrenda);
// Filtros y corazones del constructor real, no una copia de su lógica.
const tipo=ajustes.outfitPanel.querySelectorAll('select').find(s=>s.getAttribute('aria-label')==='Tipo de prenda');
const tela=ajustes.outfitPanel.querySelectorAll('select').find(s=>s.getAttribute('aria-label')==='Tela de la prenda');
const buscarPrenda=ajustes.outfitPanel.querySelector('.mods-search');
const soloFavs=ajustes.outfitPanel.querySelector('.outfit-favs-filter');
const visiblesPrenda=()=>ajustes.outfitGrid.querySelectorAll('.outfit-option').filter(c=>!c.hidden).map(c=>c.dataset.id);
const elegirFiltro=(e,valor)=>{e.value=valor;e.dispatchEvent({type:'change'});};
assert.equal(visiblesPrenda().length,totalPrendas);
elegirFiltro(tipo,'disfraz');
assert.deepEqual(visiblesPrenda(),["disfraz-diablita-corset-rojo", "disfraz-angel-corset-blanco", "disfraz-conejita-corset-negro", "disfraz-vampiresa-corset-granate", "disfraz-gatita-body-negro", "disfraz-bruja-corset-ciruela", "disfraz-pirata-corset-marfil", "disfraz-reina-egipcia-negro-dorado", "disfraz-cabaret-body-borgona", "disfraz-vaquera-body-denim", "disfraz-reina-hielo-corset-azul"]);
assert.equal(ajustes.outfitGrid.querySelectorAll('.tier-section-label').filter(e=>e.textContent==='Disfraces'&&!e.hidden).length,1);
elegirFiltro(tipo,'body');assert.equal(visiblesPrenda().length,9);
elegirFiltro(tela,'tul');assert.deepEqual(visiblesPrenda(),['square-neck-microtulle-bodysuit']);
buscarPrenda.value='cuadrado';buscarPrenda.dispatchEvent({type:'input'});
assert.deepEqual(visiblesPrenda(),['square-neck-microtulle-bodysuit']);
const favoritoCuadrado=ajustes.outfitPanel.querySelectorAll('.outfit-favorite-btn').find(b=>b.dataset.outfitId==='square-neck-microtulle-bodysuit');
const seleccionAntes=ajustes.datos.get('outfit'),previewsAntes=ajustes.previews();
const referencia=ajustes.outfitGrid.querySelectorAll('.outfit-option').find(n=>n.dataset.id==='black-rib-u-neck-top');
const tarjetaReferencia=referencia.querySelector('.outfit-card');
assert.equal(tarjetaReferencia.tagName,'button');
assert.equal(tarjetaReferencia.getAttribute('aria-pressed'),'false');
const imagenReferencia=tarjetaReferencia.querySelector('.outfit-thumb').querySelector('img');
assert.equal(imagenReferencia.src,'assets/prendas/black-rib-u-neck-top.webp');
favoritoCuadrado.click();
assert.equal(favoritoCuadrado.getAttribute('aria-pressed'),'true');
assert.equal(ajustes.datos.get('outfit'),seleccionAntes);assert.equal(ajustes.previews(),previewsAntes,'Guardar una favorita no cambia el prompt');
soloFavs.click();assert.deepEqual(visiblesPrenda(),['square-neck-microtulle-bodysuit']);
favoritoCuadrado.click();assert.equal(visiblesPrenda().length,0);
assert.equal(soloFavs.recibioFoco,true,'Quitar la última favorita visible devuelve el foco al filtro');
assert.ok(ajustes.outfitPanel.querySelector('.mods-empty').textContent.includes('Todavía no tenés prendas favoritas'));
ajustes.outfitPanel.querySelector('.outfit-reset').click();
assert.equal(visiblesPrenda().length,totalPrendas);assert.equal(tipo.value,'');assert.equal(tela.value,'');assert.equal(buscarPrenda.value,'');assert.equal(soloFavs.getAttribute('aria-pressed'),'false');
buscarPrenda.value='BODIES';buscarPrenda.dispatchEvent({type:'input'});assert.equal(visiblesPrenda().length,9,'La búsqueda reconoce la familia pública');
ajustes.outfitPanel.querySelector('.outfit-reset').click();
tarjetaReferencia.click();
assert.equal(ajustes.datos.get('outfit'),'black-rib-u-neck-top','Un toque aplica la prenda');
assert.equal(ajustes.previews(),previewsAntes+1,'Un toque actualiza el prompt');
assert.equal(ajustes.fotosAbiertas.length,0,'Elegir la prenda conserva visible el generador');
console.log('OK tipo, tela, búsqueda y favoritas combinados; corazones sin seleccionar ropa, estado vacío, foco y limpieza');
// Elegir cada prenda ejecuta su handler real y aplica su nota al texto de
// prueba. Se conservan los centinelas de Solo, Dúo y Trío sin tocar la escena.
const prendas=vm.runInContext('OUTFITS.filter(o=>o.instruction)',ajustes.ctx);
const baseSintetica='MARCADOR SINTÉTICO __N__ / __N1__ / __N2__ / __N3__. 16:9 4K.';
ajustes.ctx.baseSintetica=baseSintetica;
for(const prenda of prendas){
  const tarjeta=ajustes.outfitGrid.querySelectorAll('.outfit-card').find(n=>n.dataset.id===prenda.id);
  assert.ok(tarjeta,'Tarjeta disponible: '+prenda.id);
  const imagen=tarjeta.querySelector('img');
  assert.equal(imagen?.src,prenda.foto?'assets/prendas/'+prenda.id+'.webp':undefined,'Referencia de '+prenda.id);
  tarjeta.click();
  assert.equal(ajustes.datos.get('outfit'),prenda.id);
  assert.equal(ajustes.outfitGrid.querySelector('.selected').dataset.id,prenda.id);
  const aplicado=vm.runInContext('applyOutfitInstruction(baseSintetica,currentOutfitId)',ajustes.ctx);
  assert.ok(aplicado.startsWith(baseSintetica),'Conserva el texto de la escena: '+prenda.id);
  assert.ok(aplicado.includes(prenda.instruction),'La nota corresponde a la elección: '+prenda.id);
}
assert.equal(ajustes.fotosAbiertas.length,0,'Elegir prendas no abre el visor');
assert.deepEqual(ajustes.outfitGrid.querySelectorAll('img'),miniaturas,'Las fotos permanecen al cambiar la selección');
const ultimaPrenda=prendas.at(-1).id;
imagenReferencia.dispatchEvent({type:'error'});
assert.ok(tarjetaReferencia.querySelector('.outfit-thumb'),'El espacio de la miniatura se conserva si falla la foto');
assert.equal(tarjetaReferencia.querySelector('img'),null);
assert.equal(ajustes.datos.get('outfit'),ultimaPrenda,'Un error de imagen conserva la prenda aplicada');
console.log('OK 84 miniaturas de carga diferida y selección directa con la nota correcta de cada prenda');
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
assert.equal(contar(ajustes),totalPrendas+20+20+6+37,'Todas las opciones siguen disponibles al pedirlas');
const ilustracion=vm.runInContext('STYLES.find(s=>s.medium==="illustration")',ajustes.ctx);
ajustes.styleGrid.querySelectorAll('.style-card').find(n=>n.getAttribute('aria-label')==='Estilo '+ilustracion.name).click();
assert.equal(ajustes.outfitGrid.querySelector('.selected').dataset.id,ultimaPrenda,'Cambiar a ilustración conserva la prenda elegida');
assert.ok(ajustes.outfitGrid.querySelectorAll('.outfit-card').every(n=>n.getAttribute('aria-disabled')!=='true'));
const sinRopa=ajustes.outfitGrid.querySelectorAll('.outfit-card').find(n=>n.dataset.id==='nothing');
sinRopa.click();assert.equal(ajustes.datos.get('outfit'),'nothing');
assert.equal(sinRopa.getAttribute('aria-pressed'),'true','Sin Ropa se puede elegir con ilustración');
const fotografia=ajustes.styleGrid.querySelectorAll('.style-card').find(n=>n.getAttribute('aria-label')==='Estilo Playboy Editorial');
fotografia.click();assert.equal(ajustes.outfitGrid.querySelector('.selected').dataset.id,'nothing');
const diferida=probarAjustes();diferida.botones.btnStyle.click();
diferida.styleGrid.querySelectorAll('.style-card').find(n=>n.getAttribute('aria-label')==='Estilo '+ilustracion.name).click();
assert.equal(diferida.outfitGrid.children.length,0);
diferida.botones.btnOutfit.click();assert.equal(diferida.outfitGrid.querySelector('.selected').dataset.id,'second-skin-bodysuit');
assert.ok(diferida.outfitGrid.querySelectorAll('.outfit-card').every(n=>n.getAttribute('aria-disabled')!=='true'));
const gratis=probarAjustes(false);gratis.botones.btnOutfit.click();
const prendaGratisGuardada=gratis.datos.get('outfit');
const bloqueadas=gratis.outfitGrid.querySelectorAll('.outfit-card').filter(n=>n.classList.contains('locked'));
const bloqueadasConFoto=bloqueadas.filter(tarjeta=>tarjeta.querySelector('img'));
assert.ok(bloqueadasConFoto.length>0);
for(const tarjeta of bloqueadas)tarjeta.click();
assert.equal(gratis.outfitGrid.querySelector('.selected').dataset.id,'none');assert.equal(gratis.previews(),0);
assert.equal(gratis.fotosAbiertas.length,0);
assert.equal(gratis.planesAbiertos(),bloqueadasConFoto.length);
assert.equal(gratis.datos.get('outfit'),prendaGratisGuardada,'Ver planes conserva el ajuste guardado');
gratis.botones.btnStyle.click();
for(const tarjeta of gratis.styleGrid.querySelectorAll('.style-card').filter(n=>n.classList.contains('locked')))tarjeta.click();
assert.equal(gratis.datos.get('style'),'playboy','La compatibilidad no cambia los permisos del plan');
const restaurada=probarAjustes(true,'second-skin-bodysuit');restaurada.botones.btnOutfit.click();
assert.equal(restaurada.outfitGrid.querySelector('.selected').dataset.id,'second-skin-bodysuit','Una prenda nueva guardada se restaura al abrir');
const retirada=probarAjustes(true,'tulle-panel-bodysuit');retirada.botones.btnOutfit.click();
assert.equal(retirada.outfitGrid.querySelector('.selected').dataset.id,'none','El selector muestra Original si la prenda guardada se retiró');
console.log('OK ajustes a pedido: 0 opciones iniciales, todas disponibles, sin duplicados, prendas conservadas con ilustración y candados por plan');
for(const tier of ['casual','editorial','hot','xxx']){
  const escena=probarAjustes(true,'nothing',tier);
  escena.botones.btnStyle.click();escena.botones.btnOutfit.click();
  const estilos=vm.runInContext('STYLES',escena.ctx);
  assert.equal(escena.styleGrid.querySelectorAll('.style-card').length,estilos.length,'Todos los estilos visibles en '+tier);
  assert.equal(escena.outfitGrid.querySelectorAll('.outfit-card').length,totalPrendas,'Todas las prendas visibles en '+tier);
  for(const estilo of estilos){
    escena.styleGrid.querySelectorAll('.style-card').find(n=>n.getAttribute('aria-label')==='Estilo '+estilo.name).click();
    assert.equal(escena.datos.get('style'),estilo.id);
    assert.equal(vm.runInContext('estiloPara(cat,currentStyleId)',escena.ctx),estilo.id);
    assert.equal(escena.outfitGrid.querySelector('.selected').dataset.id,'nothing');
  }
}
console.log('OK todos los estilos y prendas disponibles en Casual, Editorial, Hot e Íntimo, sin sustituir la selección');

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
