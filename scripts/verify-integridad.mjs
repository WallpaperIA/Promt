#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { crearHandlerVersiones } from '../api/_versiones.js';
import { crearBaseVersiones, llamarVersiones } from './verify-versiones.mjs';
import { VARIANTES, TIERS, validarCategoria } from '../api/_validar.js';

function adminDB(error = null) {
  const llamadas=[];
  const cat={id:'escena-sintetica',tier:'casual',status:'publicada',name:'Escena sintética'};
  const db={llamadas, async rpc(nombre,args){llamadas.push({nombre,args});return {error};},from(tabla){
    assert.ok(['categories','prompt_bodies'].includes(tabla));
    const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},single:async()=>({data:cat,error:null}),
      then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};
    return q;
  }};
  return db;
}
function cargarAdmin(db, autorizado=true) {
  const codigo=fs.readFileSync(new URL('../api/admin/categories.js',import.meta.url),'utf8')
    .replace(/^import[^;]+;\r?\n/gm,'').replace('export default async function handler','async function handler');
  const ctx=vm.createContext({process:{env:{}},createClient:()=>db,VARIANTES,TIERS,validarCategoria,
    exigirAdmin:async(_db,_req,res)=>{if(autorizado)return {id:'admin-sintetico'};res.status(401).json({error:'no_autorizado'});return null;},
    applyCors(){},console:{error(){}}});
  vm.runInContext(codigo,ctx);return ctx.handler;
}
async function guardar(db,body,autorizado=true,method='PUT'){
  const res={codigo:200,setHeader(){},status(c){this.codigo=c;return this;},json(d){this.cuerpo=d;return this;}};
  await cargarAdmin(db,autorizado)({method,headers:{},query:{},body},res);return res;
}
let casos=0;
async function probar(t,f){await f();casos++;console.log('OK '+t);}
const cambios={id:'escena-sintetica',name:'Nombre nuevo',prompts:{prompt:'Texto sintético __N__.'}};
await probar('sin administración no se invoca el guardado',async()=>{
  const db=adminDB();assert.equal((await guardar(db,cambios,false)).codigo,401);assert.equal(db.llamadas.length,0);
});
await probar('metadata y variantes se envían en una sola operación atómica',async()=>{
  const db=adminDB();assert.equal((await guardar(db,cambios)).codigo,200);assert.equal(db.llamadas.length,1);
  const {nombre,args}=db.llamadas[0];assert.equal(nombre,'guardar_categoria_atomica');
  assert.equal(args.p_campos.name,cambios.name);assert.equal(args.p_prompts.prompt,cambios.prompts.prompt);assert.equal(args.p_crear,false);
});
await probar('crear también guarda categoría y textos en una sola RPC',async()=>{
  const db=adminDB();assert.equal((await guardar(db,{...cambios,tier:'casual'},true,'POST')).codigo,201);
  assert.equal(db.llamadas.length,1);assert.equal(db.llamadas[0].args.p_crear,true);
  assert.equal(db.llamadas[0].args.p_campos.status,'borrador');assert.equal(db.llamadas[0].args.p_campos.ready,false);
});
await probar('renombrar no envía un reemplazo vacío de variantes',async()=>{
  const db=adminDB();assert.equal((await guardar(db,{id:cambios.id,name:'Sólo nombre'})).codigo,200);
  assert.equal(db.llamadas[0].args.p_prompts,null);
});
await probar('un tier inválido se rechaza antes de escribir',async()=>{
  const db=adminDB();assert.equal((await guardar(db,{...cambios,tier:'otro'})).codigo,400);assert.equal(db.llamadas.length,0);
});
await probar('sin la RPC instalada se cierra con 503 y no se usa DELETE/INSERT',async()=>{
  const db=adminDB({code:'PGRST202'});assert.equal((await guardar(db,cambios)).codigo,503);assert.equal(db.llamadas.length,1);
});
await probar('una carga inválida devuelve 400 sin confirmar el guardado',async()=>{
  assert.equal((await guardar(adminDB({code:'22023'}),cambios)).codigo,400);
});
await probar('el límite impuesto por la base devuelve el mismo 409 de la API',async()=>{
  const db=crearBaseVersiones(),from=db.from.bind(db);
  db.from=tabla=>{const q=from(tabla);if(tabla==='prompt_versions'){
    const insertar=q.insert.bind(q),then=q.then.bind(q);let intento=false;
    q.insert=v=>{intento=true;return insertar(v);};
    q.then=(resolve,reject)=>intento?Promise.resolve({data:null,error:{code:'P0001',message:'version_limit'}}).then(resolve,reject):then(resolve,reject);
  }return q;};
  const res=await llamarVersiones(crearHandlerVersiones(db),'POST','token-a',{cat_id:'escena-prueba',variant:'prompt',title:'Prueba',body:'Sintético __N__.'});
  assert.equal(res.codigo,409);assert.equal(res.cuerpo.error,'version_limit');assert.equal(db.tablas.prompt_versions.length,0);
});
console.log(casos+' casos de integridad OK');
