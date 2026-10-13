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
  const nodo=()=>({
    dataset:{}, style:{}, hidden:false, innerHTML:'',
    classList:{toggle(){}}, setAttribute(){},
    querySelector(){return null;},
  });
  const filas=escenas.map(c=>({...nodo(),dataset:{id:c.id},style:{display:ocultas.includes(c.id)?'none':''}}));
  const ordenPintado=[], pedidos=[];
  const cuenta={textContent:''};
  const contexto=vm.createContext({
    currentAccessTier:tier, KEY_SESSION:'sesion', localStorage:{getItem:()=>token},
    window:{__destacadas:[]}, __ids:conFotos,
    document:{createElement:nodo}, acc:{querySelectorAll:()=>filas,querySelector:()=>null},
    miniaturas:{sincronizarSesion(){},fotos:new Map(fotos),pedir:id=>pedidos.push(id)},
    tarjetas:new Map(), cuenta, currentSort:orden, getSortedCategories:()=>escenas,
    grilla:{appendChild:t=>ordenPintado.push(t.dataset.id)}, observadorFotos:null,
    visual:true, elegida:null, pintarVista(){}, cleanName:s=>s, _esc:s=>s,
    icon:()=>'', ICONO_TIER:{}, esGratisVisible:()=>false,
    candadosConocidos:()=>true, canAccessCat:()=>false,
  });
  vm.runInContext('window.__conEjemplos=new Set(__ids);\n'+permiso+'\n'+html.slice(inicioPintado,finPintado)+'\nsincronizar();',contexto);
  return {ordenPintado,pedidos,cuenta:cuenta.textContent,tarjetas:contexto.tarjetas};
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
}
const filtrado=pintarCatalogo('free',null,{ocultas:['editorial-con-foto']});
assert.equal(filtrado.cuenta,'5 escenas · 1 con foto');
assert.deepEqual(filtrado.pedidos,['casual-con-foto']);
const sinFotos=pintarCatalogo('free',null,{ocultas:publicas});
assert.equal(sinFotos.cuenta,'4 escenas');
const otroOrden=pintarCatalogo('free',null,{orden:'alpha'});
assert.deepEqual(otroOrden.ordenPintado,escenas.map(c=>c.id),'Se conserva el orden elegido por la persona');
const cachePrivada=pintarCatalogo('premium','sesion-premium',{fotos:[['intimo-con-foto',{url:'https://foto.invalid/privada.jpg'}]]});
assert.ok(!cachePrivada.tarjetas.get('intimo-con-foto').innerHTML.includes('privada.jpg'));
console.log('OK orden y contador según fotos visibles, filtros, sesión gratis/Premium/Full y caché restringida');

const inicio=html.indexOf('function crearMiniaturasCatalogo(');
const fin=html.indexOf('// Una foto rota',inicio);
assert.ok(inicio>=0 && fin>inicio);
const fuente=html.slice(inicio,fin);
function entorno(fetch){
  let token='cuenta-sintetica-a', repintados=0;
  const contexto=vm.createContext({
    localStorage:{getItem:()=>token}, KEY_SESSION:'sesion', API_BASE:'https://api.invalid',
    fetch, AbortController, setTimeout, clearTimeout,
  });
  vm.runInContext(fuente,contexto);
  const carga=contexto.crearMiniaturasCatalogo(()=>repintados++);
  return {carga,token:t=>{token=t;},repintados:()=>repintados};
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
assert.ok(lote.carga.fotos.get('escena-14').url);
lote.carga.pedir('escena-14');
assert.equal(pedidos.length,15);
for(const p of pedidos){
  assert.equal(p.opciones.cache,'no-store');
  assert.equal(p.opciones.headers.Authorization,'Bearer cuenta-sintetica-a');
  assert.equal([...new URL(p.url).searchParams.keys()].join(','),'id');
}
console.log('OK carga más de ocho fotos, sin duplicados y con un máximo de cuatro pedidos');

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
assert.equal(tardias.length,4);
carrera.token('cuenta-sintetica-b');
carrera.carga.limpiar();
assert.ok(tardias.every(p=>p.opciones.signal.aborted));
carrera.carga.pedir('nueva');
for(const p of tardias.slice()) p.resolve({ok:true,json:async()=>({imagenes:['https://foto.invalid/antigua.jpg']})});
await esperar(()=>tardias.length===5);
assert.equal(carrera.carga.fotos.size,0);
assert.equal(carrera.repintados(),0);
assert.equal(tardias[4].opciones.headers.Authorization,'Bearer cuenta-sintetica-b');
tardias[4].resolve({ok:true,json:async()=>({imagenes:['https://foto.invalid/nueva.jpg']})});
await esperar(()=>carrera.carga.fotos.size===1);
assert.equal(carrera.carga.fotos.has('nueva'),true);
carrera.token(null);
carrera.carga.sincronizarSesion();
assert.equal(carrera.carga.fotos.size,0);
carrera.carga.pedir('publica');
assert.equal(tardias.length,6);
assert.equal(Object.keys(tardias[5].opciones.headers).length,0);
tardias[5].resolve({ok:true,json:async()=>({imagenes:['https://foto.invalid/publica.jpg']})});
await esperar(()=>carrera.carga.fotos.has('publica'));
console.log('OK cambiar de cuenta o salir descarta las fotos y las respuestas pendientes de la sesión anterior');

for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
console.log('OK sintaxis de los scripts de la página');
