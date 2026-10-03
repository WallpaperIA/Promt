#!/usr/bin/env node
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { crearHandlerMetricas } from '../api/_metricas.js';
import { crearBaseVersiones, llamarVersiones } from './verify-versiones.mjs';

export const ID_UMAMI_QA='f66e707b-f1b8-4444-aac4-d1fe246e9dc4';
export function crearProveedorMetricas(){
  const p={llamadas:[],modo:'actual',momento:Date.parse('2026-10-03T12:00:00Z'),
    env:{UMAMI_WEBSITE_ID:ID_UMAMI_QA,UMAMI_API_KEY:'clave-sintetica-qa'},
    async fetch(url,opciones){
      p.llamadas.push({url,opciones});
      if(p.modo==='red')throw new Error('red');
      if(typeof p.modo==='number')return{ok:false,status:p.modo};
      if(p.espera)await p.espera;
      const stats=p.modo==='legacy'?{visitors:{value:90},pageviews:{value:250}}:{visits:120,visitors:90,pageviews:250};
      const eventos=[{x:'probar-gratis',y:40},{x:'copiar-gratis',y:24},{x:'copiar',y:60},{x:'ver-planes',y:25},{x:'ir-a-patreon',y:8},{x:'dato ajeno <img>',y:999}];
      const data=url.includes('/stats?')?stats:eventos;
      if(p.modo==='invalido'&&url.includes('/stats?'))data.pageviews=-1;
      if(p.modo==='incompleto'&&!url.includes('/stats?'))return{ok:true,json:async()=>({error:'sin datos'})};
      return{ok:true,json:async()=>data};
    }
  };return p;
}
export function prepararMetricas(){
  const db=crearBaseVersiones(),p=crearProveedorMetricas();
  const handler=crearHandlerMetricas(db,{env:p.env,fetchImpl:(...a)=>p.fetch(...a),ahora:()=>p.momento});
  return{db,p,handler,llamar:(token='token-admin',query={dias:'7'},method='GET')=>llamarVersiones(handler,method,token,{},query)};
}
async function verificar(){
  let n=0;const caso=async(t,f)=>{await f();n++;console.log('OK '+t);};
  await caso('No hay informe ni llamada a Umami sin admin del servidor',async()=>{
    const s=prepararMetricas();for(const t of [null,'token-a','falso'])assert.equal((await s.llamar(t,{dias:'7',admin:true,tier:'full'})).codigo,401);assert.equal(s.p.llamadas.length,0);
  });
  await caso('Sesiones admin vencidas o inválidas se rechazan',async()=>{
    const s=prepararMetricas();for(const fecha of ['2000-01-01','no-fecha']){s.db.tablas.sessions.find(x=>x.token==='token-admin').expires_at=fecha;assert.equal((await s.llamar()).codigo,401);}assert.equal(s.p.llamadas.length,0);
  });
  await caso('OPTIONS es público y otros métodos no consultan',async()=>{
    const s=prepararMetricas();assert.equal((await s.llamar(null,{},'OPTIONS')).codigo,200);assert.equal((await s.llamar('token-admin',{},'POST')).codigo,405);assert.equal(s.p.llamadas.length,0);
  });
  await caso('Períodos y configuración inválidos fallan antes de enviar secretos',async()=>{
    const s=prepararMetricas();for(const dias of ['0','90','7&otro=1',['7']])assert.equal((await s.llamar('token-admin',{dias})).codigo,400);
    delete s.p.env.UMAMI_API_KEY;assert.equal((await s.llamar()).codigo,503);s.p.env.UMAMI_API_KEY='qa';s.p.env.UMAMI_REGION='http://otra';assert.equal((await s.llamar()).codigo,503);assert.equal(s.p.llamadas.length,0);
  });
  await caso('El informe contiene sólo números agregados y eventos conocidos',async()=>{
    const s=prepararMetricas(),r=await s.llamar();assert.equal(r.codigo,200);assert.equal(r.cabeceras['Cache-Control'],'private, no-store');
    assert.equal(r.cuerpo.paginas,250);assert.equal(r.cuerpo.visitantes,90);assert.equal(r.cuerpo.eventos['copiar-gratis'],24);
    assert(!JSON.stringify(r.cuerpo).includes('clave-sintetica'));assert(!JSON.stringify(r.cuerpo).includes('dato ajeno'));assert.equal(Object.keys(r.cuerpo.eventos).length,5);
  });
  await caso('El host, sitio y región salen del servidor, sin redirects',async()=>{
    const s=prepararMetricas();s.p.env.UMAMI_REGION='eu';await s.llamar('token-admin',{dias:'30',websiteId:'otro',url:'https://otro',key:'cliente'});
    assert(s.p.llamadas.every(x=>x.url.startsWith('https://api.umami.is/v1/eu/websites/'+ID_UMAMI_QA+'/')));
    assert(s.p.llamadas.every(x=>x.opciones.redirect==='error'&&x.opciones.headers.Authorization==='Bearer clave-sintetica-qa'));
    assert.equal(s.p.llamadas.length,2);
  });
  await caso('Umami anterior conserva valores y no inventa visitas ausentes',async()=>{
    const s=prepararMetricas();s.p.modo='legacy';const r=await s.llamar();assert.equal(r.codigo,200);assert.equal(r.cuerpo.visitas,null);assert.equal(r.cuerpo.paginas,250);assert.equal(r.cuerpo.visitantes,90);
  });
  await caso('Datos inválidos o incompletos no se presentan como cero',async()=>{
    for(const modo of ['invalido','incompleto']){const s=prepararMetricas();s.p.modo=modo;const r=await s.llamar();assert.equal(r.codigo,502);assert.equal(r.cuerpo.paginas,undefined);}
  });
  await caso('Autorización, límite y red fallida tienen errores recuperables',async()=>{
    for(const [modo,status,error] of [[401,503,'umami_autorizacion'],[429,503,'umami_limite'],['red',502,'umami_no_disponible']]){
      const s=prepararMetricas();s.p.modo=modo;const r=await s.llamar();assert.equal(r.codigo,status);assert.equal(r.cuerpo.error,error);
    }
  });
  await caso('La caché sigue comprobando el admin en cada consulta',async()=>{
    const s=prepararMetricas();await s.llamar();await s.llamar();assert.equal(s.p.llamadas.length,2);assert.equal((await s.llamar('token-a')).codigo,401);assert.equal(s.p.llamadas.length,2);
    s.p.momento+=61000;await s.llamar();assert.equal(s.p.llamadas.length,4);
  });
  await caso('Consultas simultáneas comparten el pedido agregado',async()=>{
    const s=prepararMetricas();const rs=await Promise.all(Array.from({length:5},()=>s.llamar()));assert(rs.every(r=>r.codigo===200));assert.equal(s.p.llamadas.length,2);
  });
  await caso('Un fallo no se guarda en caché y el reintento recupera',async()=>{
    const s=prepararMetricas();s.p.modo='red';assert.equal((await s.llamar()).codigo,502);s.p.modo='actual';assert.equal((await s.llamar()).codigo,200);
  });
  console.log(n+' casos de métricas OK');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)verificar().catch(e=>{console.error(e);process.exitCode=1;});
