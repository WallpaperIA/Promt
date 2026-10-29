#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Usa un Postgres local desechable, sin secretos ni datos de Wallpaperia.
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE,'wallpaperia_pruebas');
const root=fileURLToPath(new URL('../',import.meta.url));
const opciones={cwd:root,env:process.env,encoding:'utf8'};
function sql(texto){
  const r=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','-qAt'],{...opciones,input:texto});
  if(r.status!==0)throw new Error(r.stderr||r.error?.message||'psql falló');return r.stdout.trim();
}
function archivo(nombre){
  const r=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','-q','-f',nombre],opciones);
  if(r.status!==0)throw new Error(r.stderr||r.error?.message||'psql falló');
}
archivo('supabase/tests/estructura-integridad.sql');
const migraciones=fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('_seguridad_integridad_datos.sql'));
assert.equal(migraciones.length,1);archivo('supabase/migrations/'+migraciones[0]);
archivo('supabase/tests/integridad-rollback.sql');
console.log('OK rollback de metadata y variantes, renombrado y permisos de la RPC');
const usuario=sql("insert into public.users(patreon_id) values ('fixture-concurrencia') returning id;").split('\n')[0];
assert.match(usuario,/^[a-f0-9-]{36}$/);
sql(`set role service_role; insert into public.prompt_versions(user_id,cat_id,variant,title,body)
  select '${usuario}','fixture','prompt','Prueba','SINTETICO' from generate_series(1,99);`);
const insercion=`set role service_role; insert into public.prompt_versions(user_id,cat_id,variant,title,body)
  values('${usuario}','fixture','prompt','Prueba concurrente','SINTETICO');`;
function concurrente(){return new Promise((resolve,reject)=>{
  const p=spawn('psql',['-X','-v','ON_ERROR_STOP=1','-qAt'],{cwd:root,env:process.env});let error='';
  p.stderr.on('data',b=>{error+=b;});p.on('error',reject);
  p.on('close',codigo=>resolve({codigo,error}));p.stdin.end(insercion);
});}
const resultados=await Promise.all(Array.from({length:20},concurrente));
assert.equal(resultados.filter(r=>r.codigo===0).length,1);
assert.equal(resultados.filter(r=>r.codigo!==0&&r.error.includes('version_limit')).length,19);
assert.equal(sql(`select count(*) from public.prompt_versions where user_id='${usuario}';`),'100');
sql(`set role service_role; update public.prompt_versions set title='Edición permitida' where user_id='${usuario}';`);
console.log('OK 20 conexiones simultáneas: sólo entra la versión 100; editar al llegar al máximo sigue permitido');
const ajustes=fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('_ajustes_por_cuenta.sql'));
assert.equal(ajustes.length,1);archivo('supabase/migrations/'+ajustes[0]);
archivo('supabase/tests/ajustes-cuenta.sql');
console.log('OK ajustes por cuenta: permisos, RLS, revisiones, diez respaldos y borrado en cascada');
