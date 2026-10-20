#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import { bearer, resolveTier, tierComprobado, FRESCURA_TIER_MS } from '../api/_sesion.js';
import { usuarioAdmin } from '../api/_admin.js';
import * as cookies from '../api/_cookie.js';
import { applyCors } from '../api/_cors.js';
import * as patreon from '../api/_patreon.js';
import { APP_URL, REDIRECT_URI } from '../api/_config.js';
import { crearBaseVersiones } from './verify-versiones.mjs';
import { CAMPANA_PRUEBA, cabecerasSesion, tokenPrueba, hashTokenPrueba } from './_sesiones-prueba.mjs';

let casos = 0;
async function probar(nombre, fn) { await fn(); casos++; console.log('OK ' + nombre); }
function respuesta() {
  return { codigo:200, cabeceras:{}, setHeader(k,v){this.cabeceras[k.toLowerCase()]=v;},
    status(c){this.codigo=c;return this;},json(d){this.cuerpo=d;return this;},end(){return this;},
    redirect(url){this.codigo=302;this.url=url;return this;} };
}
function cargar(archivo, db, extras = {}) {
  const fuente=fs.readFileSync(new URL('../api/'+archivo,import.meta.url),'utf8')
    .replace(/^import[^;]+;\r?\n/gm,'')
    .replace(/^export const config =[^\n]+\n/gm,'')
    .replace(/export default (async )?function handler/, '$1function handler');
  const contexto=vm.createContext({Buffer,crypto,process:{env:process.env},
    console:{error(){},warn(){},log(){}},createClient:()=>db,APP_URL,REDIRECT_URI,applyCors,
    ...cookies,readCookie:cookies.leerCookie,bearer,tierComprobado,FRESCURA_TIER_MS,
    ...patreon,...extras});
  vm.runInContext(fuente,contexto);
  return contexto.handler;
}
const futuro=new Date(Date.now()+86400000).toISOString();
await probar('la cookie es aleatoria, HttpOnly, Secure, SameSite=Lax y host-only',()=>{
  const a=cookies.nuevaSesion(),b=cookies.nuevaSesion();
  assert.notEqual(a.token,b.token); assert.notEqual(a.hash,a.token);
  assert.equal(a.hash,cookies.hashSesion(a.token)); assert.equal(a.hash.length,64);
  const cookie=cookies.cookieSesion(a.token);
  for(const fragmento of ['__Host-wp_session=','HttpOnly','Secure','SameSite=Lax','Path=/'])assert.ok(cookie.includes(fragmento));
  assert.ok(!cookie.includes('Domain='));
});
await probar('Bearer, JSON, marcas públicas y cookies duplicadas no autentican',async()=>{
  const db=crearBaseVersiones();
  for(const headers of [cabecerasSesion(null,{authorization:'Bearer '+tokenPrueba('token-admin')}),
    cabecerasSesion(null,{cookie:'__Host-wp_session='+hashTokenPrueba('token-admin').slice(0,32)}),
    cabecerasSesion('token-admin',{cookie:cabecerasSesion('token-admin').cookie+'; '+cabecerasSesion('token-admin').cookie})]) {
    const req={method:'GET',headers,body:{token:tokenPrueba('token-admin'),esAdmin:true}};
    assert.equal(bearer(req),null);assert.equal(await usuarioAdmin(db,req),null);
  }
});
await probar('un origen ajeno, GitHub Pages o un POST sin Origin no usan la cookie',()=>{
  for(const extra of [{origin:'https://ajeno.invalid'},{origin:'https://wallpaperia.github.io'},{origin:undefined},{'sec-fetch-site':'cross-site'}]) {
    assert.equal(bearer({method:'POST',headers:cabecerasSesion('token-admin',extra)}),null);
  }
});
await probar('sesiones vencidas, fechas inválidas y usuarios ausentes no son admin',async()=>{
  const db=crearBaseVersiones();
  for(const expiry of ['2000-01-01T00:00:00Z','invalida',null]) {
    db.tablas.sessions[2].expires_at=expiry;
    assert.equal(await usuarioAdmin(db,{method:'GET',headers:cabecerasSesion('token-admin')}),null);
  }
  db.tablas.sessions[2].expires_at=futuro; db.tablas.users=[];
  assert.equal((await resolveTier(db,tokenPrueba('token-admin'))).admin,false);
});
await probar('una campaña ajena, desconocida o vencida no conserva un plan antiguo',()=>{
  for(const user of [
    {tier:'full',patreon_campaign_id:'999999',tier_checked_at:new Date().toISOString()},
    {tier:'full',tier_checked_at:new Date().toISOString()},
    {tier:'full',patreon_campaign_id:CAMPANA_PRUEBA,tier_checked_at:'2020-01-01T00:00:00Z'},
    {tier:'full',patreon_campaign_id:CAMPANA_PRUEBA,tier_checked_at:'invalida'},
  ])assert.equal(tierComprobado(user),'free');
  assert.equal(tierComprobado({is_admin:true}),'full');
});
await probar('verify no prolonga un permiso antiguo cuando Patreon falla',async()=>{
  const db=crearBaseVersiones();db.tablas.users[0].patreon_campaign_id=null;
  const handler=cargar('auth/verify.js',db,{revalidarTier:async()=>{throw new Error('proveedor caído');}});
  const res=respuesta(); await handler({method:'POST',headers:cabecerasSesion('token-a'),body:{tier:'full'}},res);
  assert.equal(res.codigo,200);assert.equal(res.cuerpo.tier,'free');
  assert.match(res.cuerpo.sessionId,/^[a-f0-9]{32}$/);
  assert.equal(res.cabeceras['cache-control'],'private, no-store');
});
await probar('logout borra sólo la sesión autenticada y limpia su cookie',async()=>{
  const db=crearBaseVersiones(),handler=cargar('auth/logout.js',db);
  const res=respuesta();await handler({method:'POST',headers:cabecerasSesion('token-a'),body:{token:tokenPrueba('token-b')}},res);
  assert.equal(res.codigo,200);assert.equal(db.tablas.sessions.length,2);
  assert.ok(db.tablas.sessions.some(s=>s.token===hashTokenPrueba('token-b')));
  assert.ok(res.cabeceras['set-cookie'].includes('Max-Age=0'));
  const ajeno=respuesta();await handler({method:'POST',headers:cabecerasSesion('token-b',{origin:'https://ajeno.invalid'})},ajeno);
  assert.equal(ajeno.codigo,403);assert.equal(db.tablas.sessions.length,2);
});
function baseCallback(fallo) {
  const llamadas=[];
  return {llamadas,from(tabla){
    return {upsert(datos){llamadas.push({accion:'usuario',datos});return {select:()=>({single:async()=>({data:{id:'usuario-sintetico'},error:null})})};},
      delete(){return {eq:async()=>({error:fallo==='delete'?{code:'fixture_error'}:null})};},
      async insert(datos){llamadas.push({accion:'sesion',datos});return {error:fallo==='insert'?{code:'fixture_error'}:null};}};
  }};
}
const oauth={canjearCodigo:async()=>({access_token:'proveedor-sintetico',expires_in:3600}),
  traerIdentidad:async()=>({patreonId:'patreon-sintetico',tier:'full',campaignId:CAMPANA_PRUEBA})};
await probar('OAuth entrega sólo una cookie y guarda su hash; nunca token en URL/JSON',async()=>{
  const db=baseCallback(),handler=cargar('auth/callback.js',db,oauth),res=respuesta();
  await handler({method:'GET',headers:{cookie:'oauth_state=estado-sintetico'},query:{code:'codigo',state:'estado-sintetico'}},res);
  assert.equal(res.url,APP_URL);assert.equal(new URL(APP_URL).origin,new URL(REDIRECT_URI).origin);
  const set=res.cabeceras['set-cookie'].find(c=>c.startsWith(cookies.COOKIE_SESION+'='));
  const raw=set.split(';')[0].split('=')[1];
  assert.equal(db.llamadas.find(c=>c.accion==='sesion').datos.token,cookies.hashSesion(raw));
  assert.equal(res.cuerpo,undefined);assert.ok(!res.url.includes(raw));
  assert.equal(db.llamadas[0].datos.patreon_campaign_id,CAMPANA_PRUEBA);
});
await probar('OAuth rechaza state ajeno y no confirma una sesión que no pudo guardar',async()=>{
  for(const fallo of ['state','delete','insert']){
    const db=baseCallback(fallo),handler=cargar('auth/callback.js',db,oauth),res=respuesta();
    await handler({method:'GET',headers:{cookie:'oauth_state=correcto'},query:{code:'codigo',state:fallo==='state'?'ajeno':'correcto'}},res);
    assert.equal(res.url,APP_URL+'?auth=error');
    const sets=[res.cabeceras['set-cookie']].flat();assert.ok(!sets.some(c=>c?.startsWith(cookies.COOKIE_SESION+'=')));
    if(fallo==='state')assert.equal(db.llamadas.length,0);
  }
});
process.env.PATREON_WEBHOOK_SECRET='firma-sintetica-de-prueba';
async function webhook(campaignId, opciones={}) {
  let escrituras=0;
  const db={from(){escrituras++;return {update:()=>({eq:()=>({eq:()=>({select:async()=>({data:[],error:null})})})})};}};
  const handler=cargar('webhooks/patreon.js',db),req=new PassThrough(),res=respuesta();
  const body=opciones.grande?Buffer.alloc(300000):Buffer.from(JSON.stringify({data:{attributes:{currently_entitled_amount_cents:500,patron_status:'active_patron'},relationships:{campaign:{data:{type:'campaign',id:campaignId}},user:{data:{id:'usuario-sintetico'}}}}}));
  req.method='POST';req.headers={'x-patreon-event':opciones.evento||'members:pledge:update',
    'x-patreon-signature':opciones.firma||crypto.createHmac('md5',process.env.PATREON_WEBHOOK_SECRET).update(body).digest('hex')};
  const job=handler(req,res);req.end(body);await job;return {res,escrituras};
}
await probar('el webhook real rechaza firmas inválidas antes de tocar cuentas',async()=>{
  const {res,escrituras}=await webhook(CAMPANA_PRUEBA,{firma:'a'.repeat(32)});
  assert.equal(res.codigo,401);assert.equal(escrituras,0);
});
await probar('firmar una campaña ajena o un evento desconocido no cambia planes',async()=>{
  for(const [campana,evento] of [['999999','members:pledge:update'],[CAMPANA_PRUEBA,'evento:desconocido']]){
    const {res,escrituras}=await webhook(campana,{evento});assert.equal(res.codigo,200);assert.equal(escrituras,0);
  }
  const valido=await webhook(CAMPANA_PRUEBA);assert.equal(valido.escrituras,1);
});
await probar('el cuerpo del webhook tiene un límite antes de validar o escribir',async()=>{
  const {res,escrituras}=await webhook(CAMPANA_PRUEBA,{grande:true});assert.equal(res.codigo,413);assert.equal(escrituras,0);
});
console.log(casos+' casos nuevos de seguridad OK');
