#!/usr/bin/env node
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { crearHandlerFicha, huellaPrueba } from '../api/_fichas.js';
import { crearBaseVersiones, llamarVersiones } from './verify-versiones.mjs';

// Los registros y la evidencia son sintéticos. Se ejercita el handler real
// sin publicar pruebas falsas ni necesitar el catálogo privado.
export function crearBaseFichas(){
  const db=crearBaseVersiones();
  db.tablas.categories=[{id:'escena-prueba',tier:'casual',status:'publicada'},
    {id:'escena-hot',tier:'hot',status:'publicada'}, {id:'escena-xxx',tier:'xxx',status:'publicada'},
    {id:'borrador',tier:'casual',status:'borrador'}];
  db.tablas.prompt_bodies=db.tablas.categories.flatMap(c=>['prompt','prompt2','duoPrompt'].map(variant=>({cat_id:c.id,variant,body:'Texto sintético '+variant+' __N__.'})));
  db.tablas.category_examples=db.tablas.categories.flatMap(c=>[{cat_id:c.id,ruta:c.id+'/segundo.webp',orden:1},{cat_id:c.id,ruta:c.id+'/primero.webp',orden:0}]);
  db.tablas.category_test_records=[];db.firmadas=[];
  const from=db.from.bind(db);
  db.from=tabla=>{
    const q=from(tabla);
    q.upsert=(r)=>{
      if(!db.errores[tabla]) db.tablas[tabla]=db.tablas[tabla].filter(x=>x.cat_id!==r.cat_id||x.variant!==r.variant);
      return q.insert(r);
    };return q;
  };
  db.storage={from:bucket=>({async createSignedUrl(ruta,segundos){
    db.firmadas.push({bucket,ruta,segundos});
    return db.errorFirma?{data:null,error:{code:'firma_fallida'}}:{data:{signedUrl:'https://example.test/'+ruta+'?firma=sintetica'},error:null};
  }})};
  return db;
}

async function verificar(){
  const db=crearBaseFichas(), publico=crearHandlerFicha(db), admin=crearHandlerFicha(db,true);
  const llamar=(h,m,t,b={},q={id:'escena-prueba'})=>llamarVersiones(h,m,t,b,q);
  const datos={id:'escena-prueba',variant:'prompt',model:'Modelo de QA',model_version:'qa-1',tested_on:'2026-01-01',evidence_path:'escena-prueba/primero.webp',confirmed:true};
  const original=structuredClone(db.tablas.prompt_bodies);let n=0;
  const caso=async(t,f)=>{await f();n++;console.log('OK '+t);};
  await caso('Sólo el admin resuelto en la sesión puede escribir',async()=>{
    for(const t of [null,'token-a','falso']) for(const m of ['GET','POST','DELETE']) assert.equal((await llamar(admin,m,t,{...datos,admin:true,tier:'full'})).codigo,401);
    assert.equal(db.tablas.category_test_records.length,0);
  });
  await caso('Sesiones vencidas o con fecha inválida no son admin',async()=>{
    const s=db.tablas.sessions.find(s=>s.token==='token-admin'),fecha=s.expires_at;
    for(const f of ['2000-01-01','invalid']){s.expires_at=f;assert.equal((await llamar(admin,'POST','token-admin',datos)).codigo,401);}s.expires_at=fecha;
  });
  await caso('La ruta pública sólo lee; OPTIONS no necesita sesión',async()=>{
    assert.equal((await llamar(publico,'POST','token-admin',datos)).codigo,405);
    assert.equal((await llamar(admin,'OPTIONS',null)).codigo,200);
    assert.equal((await llamar(admin,'PUT','token-admin',datos)).codigo,405);
  });
  await caso('JSON nulo, arrays, fechas falsas y campos incompletos se rechazan',async()=>{
    for(const b of ['null','[]','{"','true']) assert.equal((await llamar(admin,'POST','token-admin',b)).codigo,400);
    for(const b of [{confirmed:false},{model:''},{model_version:'x'.repeat(81)},{tested_on:'2026-02-30'},{tested_on:'2999-01-01'},{variant:'trioPrompt'},{model:'Modelo\nOtro'}])
      assert.equal((await llamar(admin,'POST','token-admin',{...datos,...b})).codigo,400);
    assert.equal(db.tablas.category_test_records.length,0);
  });
  await caso('La evidencia debe pertenecer a esa escena y existir',async()=>{
    for(const p of ['escena-hot/primero.webp','escena-prueba/no-existe.webp','../otro.webp']) assert.equal((await llamar(admin,'POST','token-admin',{...datos,evidence_path:p})).codigo,400);
  });
  await caso('La huella se calcula del original, sin aceptar la enviada',async()=>{
    assert.equal((await llamar(admin,'POST','token-admin',{...datos,body_hash:'f'.repeat(64),body:'ajeno',tested_note:'privada'})).codigo,200);
    const r=db.tablas.category_test_records[0];assert.equal(r.body_hash,huellaPrueba(original[0].body));assert.equal(r.tested_note,undefined);assert.equal(r.body,undefined);
  });
  await caso('Actualizar reemplaza sólo esa variante; no duplica filas',async()=>{
    assert.equal((await llamar(admin,'POST','token-admin',{...datos,model_version:'qa-2'})).codigo,200);assert.equal(db.tablas.category_test_records.length,1);
    assert.equal((await llamar(admin,'POST','token-admin',{...datos,variant:'prompt2'})).codigo,200);assert.equal(db.tablas.category_test_records.length,2);
  });
  await caso('La ficha pública sólo expone modelo, fecha y resultado firmado',async()=>{
    const r=await llamar(publico,'GET',null);assert.equal(r.codigo,200);assert.equal(r.cabeceras['Cache-Control'],'private, no-store');
    assert.equal(r.cuerpo.pruebas.length,2);assert.deepEqual(Object.keys(r.cuerpo.pruebas[0]).sort(),['imagen','model','model_version','tested_on','variant']);
    assert(db.firmadas.every(f=>f.bucket==='ejemplos'&&f.segundos===1800));
  });
  await caso('El panel muestra vigencia y orden real de las fotos, sin cuerpo',async()=>{
    const r=await llamar(admin,'GET','token-admin');assert.equal(r.cuerpo.imagenes[0].ruta,datos.evidence_path);assert(r.cuerpo.registros.every(r=>r.vigente));assert(!JSON.stringify(r.cuerpo).includes('Texto sintético'));
  });
  await caso('La edición o el seed invalidan el registro del original',async()=>{
    db.tablas.prompt_bodies[0].body+=' Cambio';const r=await llamar(publico,'GET',null);assert.equal(r.cuerpo.pruebas.length,1);
    assert.equal((await llamar(admin,'GET','token-admin')).cuerpo.registros.find(r=>r.variant==='prompt').vigente,false);db.tablas.prompt_bodies[0].body=original[0].body;
  });
  await caso('Quitar el resultado impide mostrar la prueba',async()=>{
    const imgs=db.tablas.category_examples;db.tablas.category_examples=imgs.filter(i=>i.ruta!==datos.evidence_path);
    assert.deepEqual((await llamar(publico,'GET',null)).cuerpo.pruebas,[]);db.tablas.category_examples=imgs;
  });
  await caso('Tier del cliente no permite consultar hot o xxx',async()=>{
    db.tablas.users[0].tier='free';db.firmadas=[];
    for(const id of ['escena-hot','escena-xxx'])assert.equal((await llamar(publico,'GET','token-a',{}, {id,tier:'full',admin:true})).codigo,403);
    assert.equal(db.firmadas.length,0);db.tablas.users[0].tier='premium';
    assert.equal((await llamar(publico,'GET','token-a',{}, {id:'escena-hot'})).codigo,200);assert.equal((await llamar(publico,'GET','token-a',{}, {id:'escena-xxx'})).codigo,403);
    db.tablas.users[0].tier='full';assert.equal((await llamar(publico,'GET','token-a',{}, {id:'escena-xxx'})).codigo,200);
  });
  await caso('Borradores y categorías inexistentes no se exponen',async()=>{
    for(const id of ['borrador','no-existe'])assert.equal((await llamar(publico,'GET','token-a',{}, {id})).codigo,404);
    assert.equal((await llamar(admin,'GET','token-admin',{}, {id:'borrador'})).codigo,200);
    assert.equal((await llamar(publico,'GET',null,{}, {id:'../otro'})).codigo,400);
  });
  await caso('Sin migración hay aviso público y error recuperable de admin',async()=>{
    db.errores.category_test_records='42P01';assert.equal((await llamar(publico,'GET',null)).cuerpo.estado,'no_disponible');
    assert.equal((await llamar(admin,'GET','token-admin')).codigo,503);assert.equal((await llamar(admin,'POST','token-admin',datos)).codigo,503);delete db.errores.category_test_records;
  });
  await caso('Fallos de base o de firma no exponen datos parciales',async()=>{
    db.errores.prompt_bodies='error';assert.equal((await llamar(publico,'GET',null)).codigo,500);delete db.errores.prompt_bodies;
    db.errorFirma=true;assert.equal((await llamar(publico,'GET',null)).codigo,500);db.errorFirma=false;
  });
  await caso('Eliminar un registro conserva las otras variantes y los originales',async()=>{
    assert.equal((await llamar(admin,'DELETE','token-admin',{}, {id:'escena-prueba',variant:'prompt'})).codigo,200);
    assert.deepEqual(db.tablas.category_test_records.map(r=>r.variant),['prompt2']);assert.deepEqual(db.tablas.prompt_bodies,original);assert.equal(db.tablas.category_examples.length,8);
  });
  console.log(`${n} casos de fichas de pruebas OK`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)verificar().catch(e=>{console.error(e);process.exitCode=1;});
