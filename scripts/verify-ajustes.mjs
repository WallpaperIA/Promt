#!/usr/bin/env node
import assert from 'node:assert/strict';
import { crearHandlerAjustes } from '../api/_ajustes.js';
import { CLAVES_AJUSTES, validarAjustes, combinarAjustes } from '../assets/ajustes-datos.js';
import { crearSincronizador } from '../assets/ajustes-cuenta.js';
import { crearBaseVersiones } from './verify-versiones.mjs';
import { prepararSesiones, cabecerasSesion } from './_sesiones-prueba.mjs';

const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',ADMIN='00000000-0000-4000-8000-000000000003';
let casos=0;
async function prueba(nombre,fn){await fn();casos++;console.log('OK '+nombre);}
const json=x=>JSON.stringify(x),clone=x=>JSON.parse(json(x));
export function fixture(){
  const db=crearBaseVersiones(),filas=new Map(),consultas=[];
  db.tablas.users=[{id:A,tier:'free'},{id:B,tier:'full'},{id:ADMIN,tier:'full',is_admin:true}];
  db.tablas.sessions=[['a',A],['b',B],['admin',ADMIN]].map(([token,user_id])=>({token,user_id,expires_at:new Date(Date.now()+86400000).toISOString()}));
  prepararSesiones(db);
  const original=db.from.bind(db);
  db.from=tabla=>{
    if(tabla!=='user_settings')return original(tabla);
    const filtros=[];let accion='leer',valores,single=false;
    const q={select(){return q;},eq(k,v){filtros.push([k,v]);return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},
      insert(v){accion='insertar';valores=v;return q;},update(v){accion='actualizar';valores=v;return q;},
      then(resolve,reject){return Promise.resolve().then(()=>{
        consultas.push({accion,filtros:clone(filtros)});
        if(accion==='insertar'){
          if(filas.has(valores.user_id))return{data:null,error:{code:'23505'}};
          filas.set(valores.user_id,clone(valores));return{data:clone(valores),error:null};
        }
        const elegidas=[...filas.values()].filter(r=>filtros.every(([k,v])=>r[k]===v));
        if(accion==='actualizar')elegidas.forEach(r=>Object.assign(r,clone(valores)));
        return{data:single?(elegidas.length?clone(elegidas[0]):null):clone(elegidas),error:null};
      }).then(resolve,reject);},};return q;
  };
  const handler=crearHandlerAjustes(db);
  async function pedir(token,method='GET',body={},query={},extra={}){
    const r={codigo:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.codigo=n;return this;},json(d){this.cuerpo=d;return this;},end(){return this;}};
    await handler({method,headers:cabecerasSesion(token,extra),body,query},r);return r;
  }
  return{db,filas,consultas,pedir};
}
const cuerpo=(id,revision,changes)=>({accountId:id,revision,changes});
await prueba('sin sesión, con sesión inventada, vencida o un origen ajeno no se leen ajustes',async()=>{
  const f=fixture();
  for(const token of [null,'inventada'])assert.equal((await f.pedir(token)).codigo,401);
  f.db.tablas.sessions[0].expires_at='2000-01-01';assert.equal((await f.pedir('a')).codigo,401);
  assert.equal((await f.pedir('b','PATCH',cuerpo(B,0,{}),{}, {origin:'https://ajeno.invalid'})).codigo,403);
  assert.equal(f.consultas.length,0);
});
await prueba('cuentas Free también guardan su perfil y el dueño sale de la cookie',async()=>{
  const f=fixture();
  const r=await f.pedir('a','PATCH',cuerpo(A,0,{wp_favs_v1:json(['escena-a'])}),{user_id:B,esAdmin:true});
  assert.equal(r.codigo,200);assert.equal(r.cuerpo.accountId,A);assert.equal(f.filas.has(B),false);
  assert.equal(r.headers['cache-control'],'private, no-store');
  assert.equal((await f.pedir('b','GET',{}, {user_id:A})).cuerpo.revision,0);
  assert.equal((await f.pedir('admin','GET',{}, {user_id:A})).cuerpo.revision,0);
});
await prueba('ni otra cuenta ni admin pueden escribir el perfil ajeno por ID',async()=>{
  const f=fixture();
  for(const token of ['b','admin']){
    const r=await f.pedir(token,'PATCH',cuerpo(A,0,{wp_style_v1:'estilo'}));
    assert.equal(r.codigo,409);assert.equal(r.cuerpo.error,'account_changed');assert.equal(r.cuerpo.settings,undefined);
  }
  assert.equal(f.filas.size,0);
});
await prueba('no se aceptan credenciales, permisos, claves extra, JSON roto o prototipos',async()=>{
  const f=fixture();
  for(const changes of [{wp_ptier_v1:'full'},{wp_session_id_v1:'secreto'},{wp_pcache_v2:'{}'}, {wp_edad_v1:'1'}, {wp_favs_v1:'{}'}, {wp_chars_v1:'[1]'},
    {wp_edits_v1:'{"__proto__":{"admin":true}}'}, {wp_favs_v1:'['}, {wp_style_v1:123}])assert.equal((await f.pedir('a','PATCH',cuerpo(A,0,changes))).codigo,400);
  assert.equal((await f.pedir('a','PATCH',{...cuerpo(A,0,{}),user_id:B})).codigo,400);
  assert.equal(f.filas.size,0);assert.equal({}.admin,undefined);
});
await prueba('dos escrituras de la misma revisión no se pisan',async()=>{
  const f=fixture();f.filas.set(A,{user_id:A,settings:{},revision:1,updated_at:'2000-01-01'});
  const r=await Promise.all(['uno','dos'].map(v=>f.pedir('a','PATCH',cuerpo(A,1,{wp_style_v1:v}))));
  assert.deepEqual(r.map(x=>x.codigo).sort(),[200,409]);assert.equal(f.filas.get(A).revision,2);
});
await prueba('el borrado explícito es propio y las escrituras demasiado rápidas se frenan',async()=>{
  const f=fixture();f.filas.set(A,{user_id:A,settings:{wp_style_v1:'antes'},revision:1,updated_at:'2000-01-01'});
  const r=await f.pedir('a','PATCH',cuerpo(A,1,{wp_style_v1:null}));assert.equal(r.codigo,200);assert.deepEqual(r.cuerpo.settings,{});
  const rapido=await f.pedir('a','PATCH',cuerpo(A,2,{wp_style_v1:'nuevo'}));assert.equal(rapido.codigo,429);assert.equal(rapido.headers['retry-after'],'1');
});
await prueba('valores enormes, métodos no permitidos y límites tienen respuesta privada',async()=>{
  const f=fixture();assert.equal(validarAjustes({wp_style_v1:'x'.repeat(151)}),false);
  for(const metodo of ['POST','DELETE','PUT'])assert.equal((await f.pedir('a',metodo)).codigo,405);
  assert.equal((await f.pedir(null,'OPTIONS')).codigo,200);
  assert.equal(CLAVES_AJUSTES.includes('wp_people_v1'),true);
});
await prueba('favoritas y eliminaciones se combinan desde la base, sin resucitar lo quitado',()=>{
  const r=combinarAjustes({wp_favs_v1:json(['a','b'])},{wp_favs_v1:json(['b','c'])},{wp_favs_v1:json(['a','b','d'])});
  assert.deepEqual(JSON.parse(r.datos.wp_favs_v1),['b','d','c']);assert.equal(r.conflictos.length,0);
});
await prueba('dos dispositivos pueden modificar personas diferentes del mismo Dúo',()=>{
  const base={duo:[{outfit:'none'},{outfit:'none'}],trio:[{},{},{}]};
  const local=clone(base),remoto=clone(base);local.duo[0].hair='cola';remoto.duo[1].outfit='vestido';
  const r=combinarAjustes({wp_people_v1:json(base)},{wp_people_v1:json(local)},{wp_people_v1:json(remoto)});
  assert.deepEqual(JSON.parse(r.datos.wp_people_v1).duo,[{outfit:'none',hair:'cola'},{outfit:'vestido'}]);assert.deepEqual(r.conflictos,[]);
});
function navegador({datos={},nube={accountId:A,settings:{},revision:0}}={}){
  const m=new Map(Object.entries(datos)),eventos=[],pedidos=[];let servidor=clone(nube),fallar=false,antesPatch=null;
  const storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};
  const pedir=async(method,body)=>{
    pedidos.push({method,body:clone(body||{})});if(fallar)throw new Error('sin-red');
    if(!servidor)return{status:401,ok:false,json:async()=>({error:'invalid_session'})};
    if(method==='PATCH'){
      if(antesPatch)await antesPatch(body);
      if(body.accountId!==servidor.accountId)return{status:409,ok:false,json:async()=>({error:'account_changed'})};
      if(body.revision!==servidor.revision)return{status:409,ok:false,json:async()=>({...clone(servidor),error:'revision_conflict'})};
      for(const[k,v]of Object.entries(body.changes)){if(v===null)delete servidor.settings[k];else servidor.settings[k]=v;}
      servidor.revision++;
    }
    const d=clone(servidor);return{status:200,ok:true,json:async()=>d};
  };
  const crear=()=>crearSincronizador({storage,pedir,estado:e=>eventos.push(e)});
  return{m,eventos,pedidos,crear,get nube(){return servidor;},set nube(v){servidor=clone(v);},set fallo(v){fallar=v;},set antesPatch(v){antesPatch=v;}};
}
await prueba('primera importación suma datos y conserva nube ante valores diferentes',async()=>{
  const n=navegador({datos:{wp_chars_v1:json([{name:'Local'}]),wp_favs_v1:json(['local']),wp_style_v1:'local'},
    nube:{accountId:A,revision:1,settings:{wp_chars_v1:json([{name:'Cuenta'}]),wp_favs_v1:json(['cuenta']),wp_style_v1:'cuenta'}}});
  const s=n.crear();assert.equal(await s.cargar(),true);
  assert.deepEqual(JSON.parse(n.nube.settings.wp_favs_v1),['cuenta','local']);
  assert.deepEqual(JSON.parse(n.nube.settings.wp_chars_v1).map(x=>x.name),['Cuenta','Local']);
  assert.equal(n.nube.settings.wp_style_v1,'cuenta');assert.ok(n.m.has('wp_settings_legacy_backup_v1'));
  assert.equal(s.exportar().respaldo.wp_style_v1,'local');
});
await prueba('otra cuenta no importa datos ni personajes del suscriptor anterior',async()=>{
  const n=navegador({datos:{wp_chars_v1:json([{name:'Personaje A'}])}}),s=n.crear();await s.cargar();
  n.nube={accountId:B,revision:1,settings:{wp_chars_v1:json([{name:'Personaje B'}])}};
  await s.cargar();assert.equal(n.m.get('wp_chars_v1'),json([{name:'Personaje B'}]));
  assert.ok(!json(n.nube).includes('Personaje A'));assert.equal(s.cuenta,B);
});
await prueba('salir conserva la copia de cuenta y deja visibles sólo datos de visitante',async()=>{
  const n=navegador({datos:{wp_favs_v1:json(['propia'])}}),s=n.crear();await s.cargar();n.nube=null;await s.cargar();
  assert.equal(n.m.has('wp_favs_v1'),false);assert.equal(s.cuenta,null);
  assert.ok(n.m.get('wp_settings_account_v1:'+A).includes('propia'));
});
await prueba('una caída de red conserva cambios y los recupera al reabrir',async()=>{
  const n=navegador(),s=n.crear();await s.cargar();n.m.set('wp_favs_v1',json(['sin-red']));n.fallo=true;
  assert.equal(await s.guardar(),false);assert.equal(n.m.get('wp_favs_v1'),json(['sin-red']));
  n.fallo=false;const siguiente=n.crear();await siguiente.cargar();assert.equal(n.nube.settings.wp_favs_v1,json(['sin-red']));
});
await prueba('los cambios hechos mientras viaja una escritura también se guardan',async()=>{
  const n=navegador(),s=n.crear();await s.cargar();n.m.set('wp_style_v1','primero');
  n.antesPatch=async()=>{n.antesPatch=null;n.m.set('wp_style_v1','segundo');};
  await s.guardar();assert.equal(n.nube.settings.wp_style_v1,'segundo');
});
await prueba('si otra pestaña cambia la cuenta durante un fetch no se cachean datos cruzados',async()=>{
  const n=navegador(),s=n.crear();await s.cargar();n.m.set('wp_style_v1','cuenta-a');
  n.antesPatch=async()=>{n.m.set('wp_settings_owner_v1',B);n.m.set('wp_style_v1','cuenta-b');};
  assert.equal(await s.guardar(),false);assert.ok(n.eventos.includes('otra-cuenta'));
  assert.equal(n.m.has('wp_settings_account_v1:'+B),false);
});
console.log(casos+' casos de seguridad, sincronización, concurrencia y recuperación de ajustes OK');
