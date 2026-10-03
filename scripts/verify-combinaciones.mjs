#!/usr/bin/env node
import assert from 'node:assert/strict';
import { crearHandlerBiblioteca } from '../api/_biblioteca.js';
import { MAX_COMBINACIONES } from '../api/_combinaciones.js';
import { crearBaseVersiones, llamarVersiones } from './verify-versiones.mjs';

const db=crearBaseVersiones(); db.tablas.prompt_combinations=[];
const handler=crearHandlerBiblioteca(db), query={recurso:'combinaciones'};
const datos={title:'Editorial vertical',settings:{style:'studio',outfit:'none',hair:'none',format:'9-16',details:['pores','bg-white','li-window']}};
const pedir=(method,token='token-a',body={},extra={})=>llamarVersiones(handler,method,token,body,{...query,...extra});
let cantidad=0,id;
const probar=async(nombre,fn)=>{await fn();cantidad++;console.log('OK '+nombre);};
await probar('La ruta anterior de versiones sigue funcionando',async()=>{
  assert.equal((await llamarVersiones(handler,'GET','token-a')).codigo,200);
  assert.equal((await pedir('GET','token-a',{}, {recurso:'desconocido'})).codigo,400);
});
await probar('Sesión y dueño salen del servidor',async()=>{
  assert.equal((await pedir('POST',null,{...datos,tier:'full'})).codigo,401);
  const r=await pedir('POST','token-a',{...datos,user_id:'cuenta-b',body:'No guardar texto privado'});
  assert.equal(r.codigo,201);id=r.cuerpo.combinacion.id;
  assert.equal(db.tablas.prompt_combinations[0].user_id,'cuenta-a');
  assert.equal(db.tablas.prompt_combinations[0].body,undefined);
  assert.equal(r.cabeceras['Cache-Control'],'private, no-store');
});
await probar('Otra cuenta y un admin no acceden ni borran por ID',async()=>{
  for(const token of ['token-b','token-admin']){
    assert.deepEqual((await pedir('GET',token)).cuerpo.combinaciones,[]);
    for(const method of ['GET','DELETE'])assert.equal((await pedir(method,token,{}, {id})).codigo,404);
  }
});
await probar('La lista es metadata; usar pide los ajustes al servidor',async()=>{
  assert.equal((await pedir('GET')).cuerpo.combinaciones[0].settings,undefined);
  assert.deepEqual((await pedir('GET','token-a',{}, {id})).cuerpo.combinacion.settings,datos.settings);
});
await probar('No guarda IDs inventados, campos de personajes ni texto de prompt',async()=>{
  for(const settings of [{...datos.settings,style:'inventado'},{...datos.settings,format:'inventado'},{...datos.settings,name:'Nombre'},
    {...datos.settings,details:['pores','pores']},{...datos.settings,details:['bg-white','bg-dark']},{...datos.settings,details:['inventado']},
    {...datos.settings,hair:'inventado'},{...datos.settings,outfit:'inventado'},null,[]])
    assert.equal((await pedir('POST','token-a',{...datos,settings})).codigo,400);
});
await probar('Valida títulos y cuerpos mal formados',async()=>{
  for(const title of ['', ' ', 'x'.repeat(81), 'Texto\nOtro'])assert.equal((await pedir('POST','token-a',{...datos,title})).codigo,400);
  assert.equal((await pedir('POST','token-a','{')).codigo,400);
  assert.equal((await pedir('GET','token-a',{}, {id:'no-uuid'})).codigo,400);
});
await probar('Bajar de plan conserva títulos y borrado, sin acceso a ajustes',async()=>{
  for(const tier of ['free','premium']){
    db.tablas.users[0].tier=tier;
    assert.equal((await pedir('GET')).cuerpo.combinaciones.length,1);
    assert.equal((await pedir('POST','token-a',{...datos,tier:'full'})).codigo,403);
    assert.equal((await pedir('GET','token-a',{}, {id})).codigo,403);
  }
  assert.equal((await pedir('DELETE','token-a',{}, {id})).codigo,200);db.tablas.users[0].tier='full';
});
await probar('El límite cuenta sólo las combinaciones del dueño',async()=>{
  db.tablas.prompt_combinations=Array.from({length:MAX_COMBINACIONES},(_,i)=>({id:'ajena-'+i,user_id:'cuenta-b'}));
  assert.equal((await pedir('POST','token-a',datos)).codigo,201);
  db.tablas.prompt_combinations=Array.from({length:MAX_COMBINACIONES},(_,i)=>({id:'propia-'+i,user_id:'cuenta-a'}));
  assert.equal((await pedir('POST','token-a',datos)).cuerpo.error,'combination_limit');
});
await probar('Sesiones vencidas y métodos ajenos se rechazan',async()=>{
  db.tablas.sessions[0].expires_at='2000-01-01';assert.equal((await pedir('GET')).codigo,401);
  db.tablas.sessions[0].expires_at=new Date(Date.now()+86400000).toISOString();
  assert.equal((await pedir('PUT')).codigo,405);assert.equal((await pedir('OPTIONS',null)).codigo,200);
});
await probar('La falta de tabla se informa sin datos de la cuenta',async()=>{
  db.errores.prompt_combinations='42P01';
  assert.deepEqual((await pedir('GET')).cuerpo,{error:'storage_unavailable'});
});
console.log(cantidad+' casos de combinaciones verificados.');
