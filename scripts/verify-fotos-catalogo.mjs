#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Se usa la función del HTML con respuestas sintéticas: no hace falta una
// cuenta real y se pueden reproducir las carreras entre dos sesiones.
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
// Se ejecuta también el pintado real: tener foto en la base no implica que
// el visitante pueda verla, ni que deba sumarse al contador de su filtro.
const inicioVista=html.indexOf('const grilla=document.getElementById(\'catalogo-grilla\')');
const inicioPintado=html.indexOf('  function sincronizar(){',inicioVista);
const finPintado=html.indexOf('  function programar(){',inicioPintado);
assert.ok(inicioVista>=0 && inicioPintado>inicioVista && finPintado>inicioPintado);
const permiso=html.match(/function puedeVerEjemplo\(cat\)\{[\s\S]*?\n\}/)?.[0] || '';
const escenas=[
  {id:'hot-con-foto',tier:'hot'}, {id:'intimo-con-foto',tier:'xxx'},
  {id:'casual-sin-foto',tier:'casual'}, {id:'editorial-con-foto',tier:'editorial'},
  {id:'casual-con-foto',tier:'casual'}, {id:'hot-sin-foto',tier:'hot'},
].map(c=>({...c,name:c.id}));
const publicas=['editorial-con-foto','casual-con-foto'];
const conFotos=['hot-con-foto','intimo-con-foto',...publicas];
function pintarCatalogo(tier,token,{ocultas=[],orden='default',fotos=[]}={}){
  const hijos=[];
  const nodo=()=>({
    dataset:{}, style:{}, hidden:false, innerHTML:'',
    classList:{toggle(){}}, setAttribute(){},
    querySelector(){return null;},
    get nextElementSibling(){return hijos[hijos.indexOf(this)+1]||null;},
  });
  const filas=escenas.map(c=>({...nodo(),dataset:{id:c.id},style:{display:ocultas.includes(c.id)?'none':''}}));
  const pedidos=[];
  let movimientos=0,lecturasSesion=0;
  const cuenta={textContent:''};
  const contexto=vm.createContext({
    currentAccessTier:tier, KEY_SESSION:'sesion', localStorage:{getItem:()=>{lecturasSesion++;return token;}},
    window:{__destacadas:[]}, __ids:conFotos,
    document:{createElement:nodo}, acc:{querySelectorAll:()=>filas,querySelector:()=>null},
    miniaturas:{sincronizarSesion(){},fotos:new Map(fotos),pedir:id=>pedidos.push(id)},
    tarjetas:new Map(), cuenta, currentSort:orden, getSortedCategories:()=>escenas,
    grilla:{
      get firstElementChild(){return hijos[0]||null;},
      insertBefore(t,antes){
        movimientos++;
        const i=hijos.indexOf(t); if(i>=0) hijos.splice(i,1);
        hijos.splice(antes ? hijos.indexOf(antes) : hijos.length,0,t);
      },
    }, observadorFotos:null,
    visual:true, elegida:null, pintarVista(){}, cleanName:s=>s, _esc:s=>s,
    icon:()=>'', ICONO_TIER:{}, esGratisVisible:()=>false,
    candadosConocidos:()=>true, canAccessCat:()=>false,
  });
  vm.runInContext('window.__conEjemplos=new Set(__ids);\n'+permiso+'\n'+html.slice(inicioPintado,finPintado)+'\nsincronizar();',contexto);
  return {ordenPintado:hijos.map(t=>t.dataset.id),pedidos,cuenta:cuenta.textContent,tarjetas:contexto.tarjetas,lecturasSesion,
    repintar(){movimientos=0;vm.runInContext('sincronizar();',contexto);return movimientos;}};
}
for(const caso of [
  {tier:'free',token:null,visibles:publicas},
  {tier:'free',token:'sesion-gratis',visibles:publicas},
  {tier:'premium',token:'sesion-premium',visibles:['hot-con-foto',...publicas]},
  {tier:'full',token:'sesion-full',visibles:conFotos},
  {tier:'full',token:null,visibles:publicas},
]){
  const p=pintarCatalogo(caso.tier,caso.token);
  const resto=escenas.map(c=>c.id).filter(id=>!caso.visibles.includes(id));
  assert.deepEqual(p.ordenPintado,[...caso.visibles,...resto],`Las fotos visibles van primero para ${caso.tier} con sesión=${!!caso.token}`);
  assert.equal(p.cuenta,'6 escenas · '+caso.visibles.length+' con foto');
  assert.deepEqual(p.pedidos,caso.visibles,'No se piden ejemplos que el plan no puede ver');
  assert.equal(p.lecturasSesion,2,'Sólo se consulta una vez cada foto Hot/Íntima; el orden no repite lecturas');
}
const filtrado=pintarCatalogo('free',null,{ocultas:['editorial-con-foto']});
assert.equal(filtrado.cuenta,'5 escenas · 1 con foto');
assert.deepEqual(filtrado.pedidos,['casual-con-foto']);
const sinFotos=pintarCatalogo('free',null,{ocultas:publicas});
assert.equal(sinFotos.cuenta,'4 escenas');
const otroOrden=pintarCatalogo('free',null,{orden:'alpha'});
assert.deepEqual(otroOrden.ordenPintado,escenas.map(c=>c.id),'Se conserva el orden elegido por la persona');
assert.equal(otroOrden.repintar(),0,'Una foto que llega no debe mover las tarjetas que ya están en orden');
const cachePrivada=pintarCatalogo('premium','sesion-premium',{fotos:[['intimo-con-foto',{url:'https://foto.invalid/privada.jpg'}]]});
assert.ok(!cachePrivada.tarjetas.get('intimo-con-foto').innerHTML.includes('privada.jpg'));
const conMini=pintarCatalogo('full','sesion-full',{fotos:[['editorial-con-foto',{url:'https://foto.invalid/original.jpg',mini:'https://foto.invalid/mini.webp'}]]});
assert.ok(conMini.tarjetas.get('editorial-con-foto').innerHTML.includes('mini.webp'));
assert.ok(!conMini.tarjetas.get('editorial-con-foto').innerHTML.includes('original.jpg'));
console.log('OK orden y contador según fotos visibles, filtros, sesión gratis/Premium/Full y caché restringida');

const inicio=html.indexOf('function crearCargaEjemplos(');
const fin=html.indexOf('// Una foto rota',inicio);
assert.ok(inicio>=0 && fin>inicio);
const fuente=html.slice(inicio,fin);
// El pedido único (?todas=1) va a su propio manejador. Sin uno, responde
// como un servidor que todavía no lo conoce: así estas pruebas cubren el
// camino de una consulta por escena, que sigue siendo el respaldo.
const servidorAnterior=async()=>({ok:false,status:400,json:async()=>({error:'bad_request'})});
function entorno(fetch,lote=servidorAnterior,apiBase='https://api.invalid'){
  let token='cuenta-sintetica-a', repintados=0, ahora=1000;
  const lotes=[];
  const enrutar=(url,opciones)=>{
    if(new URL(url,'https://cuenta.invalid').searchParams.get('todas')==='1'){ lotes.push({url,opciones}); return lote(url,opciones); }
    return fetch(url,opciones);
  };
  const contexto=vm.createContext({
    localStorage:{getItem:()=>token}, KEY_SESSION:'sesion', API_BASE:apiBase,
    fetch:enrutar, AbortController, setTimeout, clearTimeout, Date:{now:()=>ahora},
  });
  vm.runInContext(fuente,contexto);
  const carga=contexto.crearMiniaturasCatalogo(()=>repintados++);
  return {carga,compartidos:vm.runInContext('ejemplosCompartidos',contexto),contexto,lotes,
    token:t=>{token=t;},reloj:t=>{ahora=t;},repintados:()=>repintados};
}
const turno=()=>new Promise(resolve=>setImmediate(resolve));
async function esperar(condicion){
  for(let i=0;i<100 && !condicion();i++) await turno();
  assert.ok(condicion(),'La carga no terminó');
}

let activas=0, maximas=0;
const pedidos=[];
const lote=entorno(async(url,opciones)=>{
  activas++; maximas=Math.max(maximas,activas);
  pedidos.push({url,opciones});
  await turno(); activas--;
  return {ok:true,json:async()=>({imagenes:['https://foto.invalid/'+new URL(url).searchParams.get('id')+'.jpg']})};
});
for(let i=0;i<15;i++){
  lote.carga.pedir('escena-'+i);
  lote.carga.pedir('escena-'+i);
}
await esperar(()=>lote.carga.fotos.size===15);
assert.equal(pedidos.length,15);
assert.equal(maximas,4);
assert.equal(lote.lotes.length,1,'Un lote que el servidor no conoce no se repite por cada tarjeta');
assert.ok(lote.carga.fotos.get('escena-14').url);
lote.carga.pedir('escena-14');
assert.equal(pedidos.length,15);
for(const p of pedidos){
  assert.equal(p.opciones.cache,'default','La caché HTTP debe respetar el Cache-Control público/privado del servidor');
  assert.equal(p.opciones.headers.Authorization,undefined);
  assert.equal([...new URL(p.url).searchParams.keys()].join(','),'id');
}
console.log('OK carga más de ocho fotos, sin duplicados y con un máximo de cuatro pedidos');

const pedidosAntes=pedidos.length;
const repetida=await lote.compartidos.pedir('escena-14',2);
assert.ok(repetida.imagenes[0].endsWith('/escena-14.jpg'));
assert.equal(pedidos.length,pedidosAntes,'Abrir la galería debe reutilizar la firma de su miniatura');
lote.reloj(301001);
await lote.compartidos.pedir('escena-14',2);
assert.equal(pedidos.length,pedidosAntes+1,'La firma se renueva tras cinco minutos en memoria');
console.log('OK galería y portada reutilizan firmas de tarjetas, con caducidad en memoria');

const rechazadas=entorno(async url=>{
  const id=new URL(url).searchParams.get('id');
  if(id==='sin-permiso') return {ok:false,status:403,json:async()=>({imagenes:['https://foto.invalid/privada.jpg']})};
  if(id==='sin-red') throw new Error('Red no disponible');
  if(id==='json-invalido') return {ok:true,json:async()=>{throw new Error('JSON inválido');}};
  return {ok:true,json:async()=>({imagenes:[]})};
});
for(const id of ['sin-permiso','sin-red','json-invalido','vacia']) rechazadas.carga.pedir(id);
await esperar(()=>rechazadas.carga.fotos.size===4);
assert.deepEqual([...rechazadas.carga.fotos.values()],[null,null,null,null]);
console.log('OK un rechazo, una falla de red o una galería vacía no producen una miniatura');

// El servidor viejo responde aun después de abortar: la comprobación de
// sesión debe impedir que esa foto reaparezca en la cuenta siguiente.
const tardias=[];
const carrera=entorno((url,opciones)=>new Promise(resolve=>tardias.push({url,opciones,resolve})));
for(let i=0;i<6;i++) carrera.carga.pedir('anterior-'+i);
await esperar(()=>tardias.length===4);
await turno();
assert.equal(tardias.length,4);
carrera.token('cuenta-sintetica-b');
carrera.carga.limpiar();
assert.ok(tardias.every(p=>p.opciones.signal.aborted));
carrera.carga.pedir('nueva');
for(const p of tardias.slice()) p.resolve({ok:true,json:async()=>({imagenes:['https://foto.invalid/antigua.jpg']})});
await esperar(()=>tardias.length===5);
assert.equal(carrera.carga.fotos.size,0);
assert.equal(carrera.repintados(),0);
assert.equal(tardias[4].opciones.headers.Authorization,undefined);
tardias[4].resolve({ok:true,json:async()=>({imagenes:['https://foto.invalid/nueva.jpg']})});
await esperar(()=>carrera.carga.fotos.size===1);
assert.equal(carrera.carga.fotos.has('nueva'),true);
carrera.token(null);
carrera.carga.sincronizarSesion();
assert.equal(carrera.carga.fotos.size,0);
carrera.carga.pedir('publica');
await esperar(()=>tardias.length===6);
assert.equal(Object.keys(tardias[5].opciones.headers).length,0);
tardias[5].resolve({ok:true,json:async()=>({imagenes:['https://foto.invalid/publica.jpg']})});
await esperar(()=>carrera.carga.fotos.has('publica'));
console.log('OK cambiar de cuenta o salir descarta las fotos y las respuestas pendientes de la sesión anterior');

const pendientes=[];
const prioridades=entorno((url,opciones)=>new Promise(resolve=>pendientes.push({id:new URL(url).searchParams.get('id'),opciones,resolve})));
const terminar=p=>p.resolve({ok:true,status:200,json:async()=>({imagenes:['https://foto.invalid/'+p.id+'.jpg','https://foto.invalid/segunda.jpg'],miniaturas:['https://foto.invalid/'+p.id+'.mini.webp','https://foto.invalid/segunda.mini.webp']})});
const iniciales=Array.from({length:4},(_,i)=>prioridades.compartidos.pedir('activa-'+i));
const esperaMiniatura=prioridades.compartidos.pedir('en-cola');
const esperaPortada=prioridades.compartidos.pedir('portada',1);
const esperaGaleria=prioridades.compartidos.pedir('galeria',2);
assert.equal(prioridades.compartidos.pedir('galeria',2),esperaGaleria,'Dos vistas deben compartir también un pedido pendiente');
terminar(pendientes[0]);
await esperar(()=>pendientes.length===5);
assert.equal(pendientes[4].id,'galeria');
terminar(pendientes[4]);
await esperar(()=>pendientes.length===6);
assert.equal(pendientes[5].id,'portada');
terminar(pendientes[5]);
await esperar(()=>pendientes.length===7);
for(const p of pendientes.slice(1,4)) terminar(p);
terminar(pendientes[6]);
await Promise.all([...iniciales,esperaMiniatura,esperaPortada,esperaGaleria]);
assert.equal((await esperaGaleria).imagenes.length,2,'La caché compartida conserva la galería completa');
console.log('OK prioridad de escena abierta, deduplicación pendiente y límite común entre las tres vistas');

// Una de ocho consultas termina mientras las otras siguen pendientes. La
// portada tiene que mostrarla ya, conservando ese nodo al llegar las demás.
function entornoPortada(fetch,lote){
const base=entorno(fetch,lote);
const pista={children:[],dataset:{},set innerHTML(v){this.children=[];},insertAdjacentHTML(pos,markup){this.children.push({markup});}};
const tira={hidden:true}, hero={classList:{remove(){}}};
let sinFotos=0;
Object.assign(base.contexto,{
  window:{}, CATEGORIES:Array.from({length:8},(_,i)=>({id:'publica-'+i,tier:'editorial',name:'Escena '+i})),
  getTrash:()=>[], cleanName:s=>s, _esc:s=>s, esGratisVisible:()=>false,
  document:{getElementById:id=>({'lp-tira-pista':pista,'lp-tira':tira,'lp-section':hero}[id]),querySelector:()=>null},
  acc:{querySelector:()=>null}, CSS:{escape:s=>s}, portadaSinFotos(){sinFotos++;},
});
vm.runInContext('window.__conEjemplos=new Set(CATEGORIES.map(c=>c.id));',base.contexto);
const fuenteDestacada=html.slice(html.indexOf('function destacadaHTML('),html.indexOf('/** Icono de cada nivel'));
const fuentePortada=html.slice(html.indexOf('let revisionDestacadas=0;'),html.indexOf('// El ejemplo público'));
vm.runInContext(fuenteDestacada+'\n'+fuentePortada,base.contexto);
return {...base,pista,tira,sinFotos:()=>sinFotos};
}
const solicitudes=[];
const progresiva=entornoPortada(url=>new Promise(resolve=>solicitudes.push({id:new URL(url).searchParams.get('id'),resolve})));
const {pista,tira}=progresiva;
const portada=progresiva.contexto.cargarDestacadas();
await esperar(()=>solicitudes.length===4);
await turno();
assert.equal(solicitudes.length,4);
terminar(solicitudes[2]);
await esperar(()=>pista.children.length===1);
const primera=pista.children[0];
assert.equal(tira.hidden,false);
assert.ok(primera.markup.includes('loading="eager" fetchpriority="high"'));
assert.ok(primera.markup.includes('src="https://foto.invalid/publica-2.jpg"'),'La foto principal conserva la original');
assert.equal(progresiva.contexto.window.__destacadas.length,1);
for(let i=0;i<5;i++){
  await esperar(()=>solicitudes.length>i);
  if(i!==2) terminar(solicitudes[i]);
  await turno();
}
await portada;
assert.equal(pista.children.length,5);
assert.equal(pista.children[0],primera,'La primera foto no se reconstruye al completar otras consultas');
assert.ok(pista.children.slice(1).every(n=>n.markup.includes('.mini.webp')),'Las fotos chicas conservan las miniaturas de main');
assert.equal(progresiva.contexto.window.__destacadas.length,5);
assert.equal(solicitudes.length,5,'Cinco fotos válidas no deben disparar ocho consultas de portada');
assert.equal(progresiva.sinFotos(),0);
console.log('OK portada progresiva: cinco fotos válidas usan cinco consultas y conservan sus nodos');

const reemplazos=[];
const incompleta=entornoPortada(async url=>{
  const id=new URL(url).searchParams.get('id');reemplazos.push(id);
  return Number(id.split('-').at(-1))<3
    ? {ok:false,status:403,json:async()=>({})}
    : {ok:true,json:async()=>({imagenes:['https://foto.invalid/'+id+'.jpg']})};
});
await incompleta.contexto.cargarDestacadas();
assert.equal(reemplazos.length,8,'Se pueden probar hasta ocho candidatos si fallan los primeros');
assert.equal(incompleta.pista.children.length,5);
assert.equal(incompleta.sinFotos(),0);
const vacia=entornoPortada(async()=>({ok:true,json:async()=>({imagenes:[]})}));
await vacia.contexto.cargarDestacadas();
assert.equal(vacia.pista.children.length,0);assert.equal(vacia.sinFotos(),1);
console.log('OK reemplazos tras fallos y portada vacía sin consultas ilimitadas');

const anteriores=[];
const portadaAnterior=entornoPortada(url=>new Promise(resolve=>anteriores.push({id:new URL(url).searchParams.get('id'),resolve})));
const cargarAnterior=portadaAnterior.contexto.cargarDestacadas();
await esperar(()=>anteriores.length===4);
portadaAnterior.token('otra-cuenta');
for(const p of anteriores) terminar(p);
await cargarAnterior;
assert.equal(portadaAnterior.pista.children.length,0);
assert.equal(anteriores.length,4,'Cambiar de sesión detiene los reemplazos pendientes de la portada anterior');
console.log('OK la portada anterior no agrega fotos ni sigue consultando tras un cambio de sesión');

// ── El lote: una consulta para todas las tarjetas, filas y portada ──
const respuestaLote={fotos:{
  'con-mini':{imagen:'https://foto.invalid/con-mini.jpg',miniatura:'https://foto.invalid/con-mini.mini.webp'},
  'sin-mini':{imagen:'https://foto.invalid/sin-mini.jpg'},
  'invalida':{imagen:''},
}};
const porEscena=[];
const conLote=entorno(async url=>{
  const id=new URL(url).searchParams.get('id'); porEscena.push(id);
  return {ok:true,json:async()=>({imagenes:['https://foto.invalid/'+id+'.jpg']})};
},async()=>({ok:true,json:async()=>respuestaLote}));
for(let i=0;i<20;i++) conLote.carga.pedir('con-mini');
conLote.carga.pedir('sin-mini'); conLote.carga.pedir('subida-despues');
await esperar(()=>conLote.carga.fotos.size===3);
assert.equal(conLote.lotes.length,1,'Todas las tarjetas comparten un solo pedido');
assert.deepEqual(porEscena,['subida-despues'],'Sólo se consulta aparte lo que no vino en el lote');
assert.equal(conLote.carga.fotos.get('con-mini').mini,'https://foto.invalid/con-mini.mini.webp');
assert.equal(conLote.carga.fotos.get('con-mini').url,'https://foto.invalid/con-mini.jpg');
assert.equal(conLote.carga.fotos.get('sin-mini').mini,'https://foto.invalid/sin-mini.jpg','Sin miniatura, la tarjeta usa la original');
assert.equal(new URL(conLote.lotes[0].url).searchParams.get('cuenta'),null,'Desde el enlace público el lote puede salir de la caché del CDN');
assert.equal(conLote.lotes[0].opciones.cache,'default');
assert.equal(Object.keys(conLote.lotes[0].opciones.headers).length,0,'El lote no manda credenciales propias');
assert.ok(conLote.compartidos.loteListo().has('con-mini'));
assert.ok(!conLote.compartidos.loteListo().has('invalida'),'Una entrada sin URL no cuenta como foto');
conLote.reloj(300000);
await conLote.compartidos.lote();
assert.equal(conLote.lotes.length,1,'Dentro de los cinco minutos se reutiliza');
conLote.reloj(302000);
assert.equal(conLote.compartidos.loteListo(),null);
await conLote.compartidos.lote();
assert.equal(conLote.lotes.length,2,'Pasados cinco minutos se renuevan las firmas');
console.log('OK un solo pedido para todas las tarjetas, miniatura o respaldo, y renovación a los cinco minutos');

const enCuenta=entorno(async()=>({ok:true,json:async()=>({imagenes:[]})}),async()=>({ok:true,json:async()=>({fotos:{}})}),'');
enCuenta.carga.pedir('x');
await esperar(()=>enCuenta.lotes.length===1);
assert.equal(new URL(enCuenta.lotes[0].url,'https://cuenta.invalid').searchParams.get('cuenta'),'1','En la cuenta el lote nunca usa la caché compartida');
console.log('OK en el origen de la cuenta el lote va con cuenta=1');

const lotesPendientes=[];
const cambio=entorno(async()=>({ok:true,json:async()=>({imagenes:[]})}),
  (url,opciones)=>new Promise(resolve=>lotesPendientes.push({opciones,resolve})));
cambio.carga.pedir('hot-privada');
await esperar(()=>lotesPendientes.length===1);
cambio.token('otra-cuenta'); cambio.carga.limpiar();
assert.ok(lotesPendientes[0].opciones.signal.aborted,'El lote de la sesión anterior se cancela');
lotesPendientes[0].resolve({ok:true,json:async()=>({fotos:{'hot-privada':{imagen:'https://foto.invalid/privada.jpg'}}})});
for(let i=0;i<5;i++) await turno();
assert.equal(cambio.carga.fotos.size,0);
assert.equal(cambio.compartidos.loteListo(),null,'La respuesta tardía no queda para la cuenta nueva');
cambio.carga.pedir('publica');
await esperar(()=>lotesPendientes.length===2);
lotesPendientes[1].resolve({ok:true,json:async()=>({fotos:{publica:{imagen:'https://foto.invalid/publica.jpg'}}})});
await esperar(()=>cambio.carga.fotos.has('publica'));
assert.ok(!cambio.compartidos.loteListo().has('hot-privada'));
assert.ok(!cambio.carga.fotos.has('hot-privada'));
console.log('OK cambiar de cuenta cancela el lote anterior y no reutiliza sus fotos');

const consultasPortada=[];
const loteDePortada=async()=>({ok:true,json:async()=>({fotos:Object.fromEntries(Array.from({length:8},(_,i)=>i)
  .filter(i=>i!==0).map(i=>['publica-'+i,{imagen:'https://foto.invalid/publica-'+i+'.jpg',miniatura:'https://foto.invalid/publica-'+i+'.mini.webp'}]))})});
const desdeLote=entornoPortada(async url=>{consultasPortada.push(url);return {ok:true,json:async()=>({imagenes:[]})};},loteDePortada);
await desdeLote.contexto.cargarDestacadas();
assert.equal(desdeLote.lotes.length,1);
assert.equal(consultasPortada.length,0,'Con lote, la portada no hace consultas propias');
assert.equal(desdeLote.pista.children.length,5);
assert.equal(desdeLote.contexto.window.__destacadas.map(x=>x.id).join(),'publica-1,publica-2,publica-3,publica-4,publica-5','Una escena sin foto en el lote se saltea');
assert.ok(desdeLote.pista.children[0].markup.includes('loading="eager" fetchpriority="high"'));
assert.ok(desdeLote.pista.children[0].markup.includes('src="https://foto.invalid/publica-1.jpg"'),'La foto principal usa la original');
assert.ok(desdeLote.pista.children.slice(1).every(n=>n.markup.includes('.mini.webp')),'Las chicas usan la miniatura');
assert.equal(desdeLote.sinFotos(),0);
const loteVacio=entornoPortada(async()=>{throw new Error('No debería consultar de a una');},async()=>({ok:true,json:async()=>({fotos:{}})}));
await loteVacio.contexto.cargarDestacadas();
assert.equal(loteVacio.pista.children.length,0);
assert.equal(loteVacio.sinFotos(),1);
console.log('OK la portada sale del lote sin consultas propias, y sin fotos se oculta');

// ── Filas de Lista ──
const fuenteFoto=html.slice(html.indexOf('function ponerFoto('),html.indexOf('/** Sin fotos, la columna'));
const fuenteFilas=html.slice(html.indexOf('  // En Lista cada fila lleva'),html.indexOf('  // Devuelve la foto que quedó'));
assert.ok(fuenteFoto.includes('function quitarFoto(') && fuenteFilas.includes('function pintarFilas('));
function entornoFilas({visual=false,lote=null,destacadas=[],ocultas=[]}={}){
  const crearNum=tier=>{
    const n={dataset:{tier},clases:new Set(),escrituras:0,firstChild:null,_html:'icono',
      classList:{add:c=>n.clases.add(c),remove:c=>n.clases.delete(c)}};
    Object.defineProperty(n,'innerHTML',{get(){return n._html;},set(v){n._html=v;n.escrituras++;n.firstChild=v.startsWith('<img')?{src:''}:null;}});
    return n;
  };
  const ids=['a','b','sin-foto','hot','oculta'];
  const filas=new Map(ids.map(id=>{const num=crearNum(id==='hot'?'hot':'casual');return [id,{num,style:{display:ocultas.includes(id)?'none':''},querySelector:()=>num}];}));
  let pedidosLote=0, programados=0;
  const contexto=vm.createContext({
    visual, window:{__destacadas:destacadas}, icon:n=>'icono-'+n, ICONO_TIER:{casual:'dress',hot:'flame'},
    miniaturas:{fotos:new Map()}, programar(){programados++;},
    ejemplosCompartidos:{loteListo:()=>lote,lote(){pedidosLote++;return Promise.resolve(new Map());}},
  });
  vm.runInContext(fuenteFoto+'\n'+fuenteFilas,contexto);
  return {filas,num:id=>filas.get(id).num,pintar:visibles=>contexto.pintarFilas(new Set(visibles),filas),
    pedidosLote:()=>pedidosLote,programados:()=>programados};
}
const mapaLote=new Map([
  ['a',{id:'a',url:'https://foto.invalid/a.jpg',mini:'https://foto.invalid/a.mini.webp'}],
  ['b',{id:'b',url:'https://foto.invalid/b.jpg',mini:'https://foto.invalid/b.jpg'}],
  ['hot',{id:'hot',url:'https://foto.invalid/hot.jpg',mini:'https://foto.invalid/hot.mini.webp'}],
  ['oculta',{id:'oculta',url:'https://foto.invalid/oculta.jpg',mini:'https://foto.invalid/oculta.jpg'}],
]);
const lista=entornoFilas({lote:mapaLote,ocultas:['oculta']});
lista.pintar(['a','b','oculta']);
assert.equal(lista.num('a').firstChild.src,'https://foto.invalid/a.mini.webp','La fila usa la miniatura');
assert.ok(lista.num('a').clases.has('con-foto'));
assert.equal(lista.num('b').firstChild.src,'https://foto.invalid/b.jpg');
assert.equal(lista.num('sin-foto').escrituras,0,'Una escena sin foto conserva su icono');
assert.equal(lista.num('hot').escrituras,0,'Lo que el plan no ve no se pinta aunque esté en memoria');
assert.equal(lista.num('oculta').escrituras,0,'Una fila oculta por el filtro no se toca');
assert.equal(lista.pedidosLote(),0,'Con el lote recibido no se pide nada');
const escriturasA=lista.num('a').escrituras;
lista.pintar(['a','b','oculta']);
assert.equal(lista.num('a').escrituras,escriturasA,'Repintar sin cambios no toca el DOM');
lista.pintar(['b']);
assert.equal(lista.num('a')._foto,null,'Si la sesión ya no la permite, la foto se quita');
assert.equal(lista.num('a').innerHTML,'icono-dress');
assert.ok(!lista.num('a').clases.has('con-foto'));
lista.num('b')._fotoFallida='https://foto.invalid/b.jpg';
lista.num('b')._foto=null;
const escriturasB=lista.num('b').escrituras;
lista.pintar(['b']);
assert.equal(lista.num('b').escrituras,escriturasB,'Una foto rota no se vuelve a poner');
console.log('OK Lista: cada fila con su miniatura, sin repintar, sin fotos ajenas al plan ni filas ocultas');

const sinLote=entornoFilas({destacadas:[{id:'a',url:'https://foto.invalid/da.jpg',mini:'https://foto.invalid/da.mini.webp'}]});
sinLote.pintar(['a','b']);
assert.equal(sinLote.pedidosLote(),1,'Sin lote recibido, Lista lo pide');
assert.equal(sinLote.num('a').firstChild.src,'https://foto.invalid/da.mini.webp','Mientras llega, se usan las de la portada');
assert.equal(sinLote.num('b').escrituras,0);
await turno();
assert.equal(sinLote.programados(),1,'Al llegar el lote se vuelve a pintar');
const enExplorar=entornoFilas({visual:true,lote:mapaLote});
enExplorar.pintar(['a','b']);
assert.equal(enExplorar.num('a').escrituras+enExplorar.pedidosLote(),0,'En Explorar las filas no se tocan');
console.log('OK Lista pide el lote si falta, usa la portada mientras tanto y Explorar no toca filas');

for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
console.log('OK sintaxis de los scripts de la página');
