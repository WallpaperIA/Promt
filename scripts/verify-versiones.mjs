#!/usr/bin/env node
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { crearHandlerVersiones, MAX_VERSIONES } from '../api/_versiones.js';

// La base sintética responde a las consultas del handler real. Mantiene filas
// de dos dueños para detectar filtrados omitidos sin tocar Supabase ni prompts.
export function crearBaseVersiones() {
  const futuro = new Date(Date.now() + 86400000).toISOString();
  const db = {
    tablas: {
      users: [{ id: 'cuenta-a', tier: 'full' }, { id: 'cuenta-b', tier: 'full' }, { id: 'admin', tier: 'free', is_admin: true }],
      sessions: [{ token: 'token-a', user_id: 'cuenta-a', expires_at: futuro }, { token: 'token-b', user_id: 'cuenta-b', expires_at: futuro }, { token: 'token-admin', user_id: 'admin', expires_at: futuro }],
      categories: [{ id: 'escena-prueba', ready: true, status: 'publicada' }],
      prompt_bodies: ['prompt','prompt2','duoPrompt','duoPrompt2','trioPrompt','trioPrompt2'].map(variant=>({cat_id:'escena-prueba',variant})),
      prompt_versions: [],
    },
    errores: {},
    from(tabla) {
      const filtros=[], ordenes=[];
      let operacion='leer', campos='*', valores, rango, singular=false, cuenta=false, cabeza=false;
      const q={
        select(c,o){ campos=c; cuenta=!!o?.count; cabeza=!!o?.head; return q; },
        eq(c,v){ filtros.push([c,v]); return q; },
        order(c,o){ ordenes.push([c,o]); return q; },
        range(a,b){ rango=[a,b]; return q; },
        insert(v){ operacion='crear'; valores=v; return q; },
        update(v){ operacion='editar'; valores=v; return q; },
        delete(){ operacion='borrar'; return q; },
        single(){ singular=true; return q; },
        maybeSingle(){ singular=true; return q; },
        then(resolve,reject){
          return Promise.resolve().then(()=>{
            if(db.errores[tabla]) return {data:null,error:{code:db.errores[tabla]}};
            const cumple=r=>filtros.every(([c,v])=>r[c]===v);
            let filas=db.tablas[tabla].filter(cumple);
            if(operacion==='crear'){
              const fila={created_at:new Date().toISOString(),...valores}; db.tablas[tabla].push(fila); filas=[fila];
            } else if(operacion==='editar') filas.forEach(f=>Object.assign(f,valores));
            else if(operacion==='borrar') db.tablas[tabla]=db.tablas[tabla].filter(r=>!cumple(r));
            for(const [c,o] of [...ordenes].reverse()) filas.sort((a,b)=>String(a[c]).localeCompare(String(b[c]))*(o.ascending?1:-1));
            const total=filas.length;
            if(rango) filas=filas.slice(rango[0],rango[1]+1);
            const salida=filas.map(r=>{
              if(tabla==='sessions') return {...r,users:db.tablas.users.find(u=>u.id===r.user_id)};
              if(campos==='*') return {...r};
              return Object.fromEntries(campos.split(',').map(c=>c.trim()).map(c=>[c,r[c]]));
            });
            if(cuenta) return {data:cabeza?null:salida,count:total,error:null};
            return {data:singular?(salida[0]||null):salida,error:null};
          }).then(resolve,reject);
        },
      };
      return q;
    },
  };
  return db;
}

export async function llamarVersiones(handler, method, token, body={}, query={}) {
  const res={codigo:200,cabeceras:{},setHeader(k,v){this.cabeceras[k]=v;},status(c){this.codigo=c;return this;},json(b){this.cuerpo=b;return this;},end(){return this;}};
  await handler({method,headers:{authorization:token?'Bearer '+token:'',origin:'https://wallpaperia.github.io'},body,query},res);
  return res;
}

async function verificarOrganizacion() {
  const db=crearBaseVersiones(), handler=crearHandlerVersiones(db);
  const datos={cat_id:'escena-prueba',variant:'prompt',title:'Prueba',body:'Texto sintético __N__',folder:'Retratos',tags:['editorial','vertical']};
  const pedir=(method,body={},query={},token='token-a')=>llamarVersiones(handler,method,token,body,query);
  let cantidad=0,id;
  const probar=async(nombre,fn)=>{await fn();cantidad++;console.log('OK '+nombre);};
  await probar('Guarda carpeta y etiquetas; la lista conserva sólo metadata',async()=>{
    const r=await pedir('POST',datos);assert.equal(r.codigo,201);id=r.cuerpo.version.id;
    assert.equal(r.cuerpo.version.folder,datos.folder);assert.deepEqual(r.cuerpo.version.tags,datos.tags);
    const meta=(await pedir('GET')).cuerpo.versiones[0];assert.equal(meta.body,undefined);assert.deepEqual(meta.tags,datos.tags);
  });
  await probar('Un cliente viejo no borra la organización',async()=>{
    const {folder,tags,...viejo}=datos;
    const r=await pedir('PUT',{...viejo,revision:1},{id});assert.equal(r.codigo,200);
    assert.equal(r.cuerpo.version.folder,folder);assert.deepEqual(r.cuerpo.version.tags,tags);
  });
  await probar('La revisión también evita pisar carpetas y etiquetas',async()=>{
    assert.equal((await pedir('PUT',{...datos,folder:'Portadas',revision:2},{id})).codigo,200);
    assert.equal((await pedir('PUT',{...datos,folder:'Redes',revision:2},{id})).codigo,409);
    assert.equal(db.tablas.prompt_versions[0].folder,'Portadas');
  });
  await probar('Valida tamaños, tipos y duplicados sin cambiar la copia',async()=>{
    for(const campos of [{folder:'x'.repeat(81)},{folder:[]},{folder:'A\nB'},{tags:['']},{tags:['x'.repeat(25)]},
      {tags:['A','a']},{tags:'editorial'},{tags:Array.from({length:9},(_,i)=>String(i))},{tags:[null]}])
      assert.equal((await pedir('PUT',{...datos,...campos,revision:3},{id})).codigo,400);
    assert.equal(db.tablas.prompt_versions[0].revision,3);
  });
  await probar('Otra cuenta ni un admin pueden ver etiquetas ajenas',async()=>{
    for(const token of ['token-b','token-admin']){
      assert.deepEqual((await pedir('GET',{}, {},token)).cuerpo.versiones,[]);
      assert.equal((await pedir('PUT',{...datos,revision:3},{id},token)).codigo,404);
    }
  });
  await probar('Bajar de plan conserva la organización y permite borrar',async()=>{
    db.tablas.users[0].tier='free';const meta=(await pedir('GET')).cuerpo.versiones[0];
    assert.equal(meta.folder,'Portadas');assert.equal(meta.body,undefined);
    assert.equal((await pedir('PUT',{...datos,revision:3},{id})).codigo,403);
    assert.equal((await pedir('DELETE',{}, {id})).codigo,200);db.tablas.users[0].tier='full';
  });
  await probar('Una copia nueva sin organización funciona igual',async()=>{
    const {folder,tags,...viejo}=datos;const r=await pedir('POST',viejo);
    assert.equal(r.cuerpo.version.folder,'');assert.deepEqual(r.cuerpo.version.tags,[]);
  });
  await probar('La falta de columnas informa la migración pendiente',async()=>{
    db.errores.prompt_versions='42703';assert.equal((await pedir('GET')).cuerpo.error,'storage_unavailable');
  });
  console.log(cantidad+' casos de organización verificados.');
}

async function verificar() {
  const db=crearBaseVersiones(), handler=crearHandlerVersiones(db), original=structuredClone(db.tablas.prompt_bodies);
  let cantidad=0;
  const probar=async(nombre,fn)=>{await fn();cantidad++;console.log('OK '+nombre);};
  const datos={cat_id:'escena-prueba',variant:'prompt',title:'Mi prueba',body:'Texto sintético __N__ y __N_HAIR__.'};
  let id;
  await probar('Sin sesión ni tier declarado no hay biblioteca',async()=>{
    const r=await llamarVersiones(handler,'POST',null,{...datos,tier:'full',user_id:'cuenta-a'});assert.equal(r.codigo,401);
  });
  await probar('El dueño sale de la sesión, aunque el cliente declare otro',async()=>{
    const r=await llamarVersiones(handler,'POST','token-a',{...datos,user_id:'cuenta-b',tier:'free'});
    assert.equal(r.codigo,201);id=r.cuerpo.version.id;assert.equal(db.tablas.prompt_versions[0].user_id,'cuenta-a');
    assert.equal(r.cuerpo.version.user_id,undefined);assert.equal(r.cabeceras['Cache-Control'],'private, no-store');
  });
  await probar('La lista de otra cuenta no devuelve ni títulos ni cuerpos ajenos',async()=>{
    const r=await llamarVersiones(handler,'GET','token-b',{}, {user_id:'cuenta-a'});assert.deepEqual(r.cuerpo.versiones,[]);
  });
  await probar('Otra cuenta no puede abrir, editar ni borrar por ID conocido',async()=>{
    for(const metodo of ['GET','PUT','DELETE']){
      const r=await llamarVersiones(handler,metodo,'token-b',{...datos,revision:1}, {id});assert.equal(r.codigo,404);
    }
    assert.equal(db.tablas.prompt_versions.length,1);assert.equal(db.tablas.prompt_versions[0].revision,1);
  });
  await probar('Ser administrador no permite leer una copia ajena',async()=>{
    assert.equal((await llamarVersiones(handler,'GET','token-admin',{}, {id})).codigo,404);
    assert.equal((await llamarVersiones(handler,'DELETE','token-admin',{}, {id})).codigo,404);
  });
  await probar('El dueño abre su plantilla; la lista sólo lleva metadata',async()=>{
    const r=await llamarVersiones(handler,'GET','token-a',{}, {id});assert.equal(r.cuerpo.version.body,datos.body);
    const lista=await llamarVersiones(handler,'GET','token-a');assert.equal(lista.cuerpo.versiones[0].body,undefined);
  });
  await probar('Dos guardados con la misma revisión no se pisan',async()=>{
    const r=await Promise.all(['Uno','Dos'].map(title=>llamarVersiones(handler,'PUT','token-a',{...datos,title,revision:1},{id})));
    assert.deepEqual(r.map(x=>x.codigo).sort(),[200,409]);assert.equal(db.tablas.prompt_versions[0].revision,2);
  });
  await probar('Una copia no se cambia de escena ni de variante',async()=>{
    const r=await llamarVersiones(handler,'PUT','token-a',{...datos,cat_id:'otra-escena',revision:2},{id});assert.equal(r.codigo,400);
  });
  await probar('Las seis variantes conservan sus propios centinelas',async()=>{
    for(const variant of ['prompt','prompt2','duoPrompt','duoPrompt2','trioPrompt','trioPrompt2']){
      const body=variant.startsWith('trio')?'Texto __N1__ __N2__ __N3__':variant.startsWith('duo')?'Texto __N1__ __N2__':'Texto __N__';
      assert.equal((await llamarVersiones(handler,'POST','token-a',{...datos,variant,body})).codigo,201);
    }
  });
  await probar('Rechaza plantillas incompletas, centinelas ajenos y exceso de texto',async()=>{
    for(const cambio of [{body:'Sin marcador'},{body:'__N__ __N2__'},{variant:'__proto__'},{title:' '},{title:'x'.repeat(81)},{body:'__N__'+'x'.repeat(20000)},{variant:'duoPrompt',body:'__N1__'}]){
      assert.equal((await llamarVersiones(handler,'POST','token-a',{...datos,...cambio})).codigo,400);
    }
  });
  await probar('No se crean copias de una escena ausente o sin publicar',async()=>{
    assert.equal((await llamarVersiones(handler,'POST','token-a',{...datos,cat_id:'ausente'})).codigo,404);
    db.tablas.categories[0].status='borrador';assert.equal((await llamarVersiones(handler,'POST','token-a',datos)).codigo,404);db.tablas.categories[0].status='publicada';
  });
  await probar('Bajar de plan conserva copias sin devolver el texto',async()=>{
    for(const tier of ['premium','free']){
      db.tablas.users[0].tier=tier;
      const lista=await llamarVersiones(handler,'GET','token-a');assert.equal(lista.codigo,200);assert(lista.cuerpo.versiones.length>0);assert(!JSON.stringify(lista.cuerpo).includes(datos.body));
      for(const metodo of ['POST','PUT','GET']) assert.equal((await llamarVersiones(handler,metodo,'token-a',{...datos,tier:'full',revision:2},{id})).codigo,403);
    }
    assert.equal((await llamarVersiones(handler,'DELETE','token-a',{}, {id})).codigo,200);db.tablas.users[0].tier='full';
  });
  await probar('Sesiones inexistentes, vencidas o con fecha inválida no leen nada',async()=>{
    assert.equal((await llamarVersiones(handler,'GET','inventada')).codigo,401);
    for(const expires_at of ['2000-01-01','no-es-fecha']){
      db.tablas.sessions[0].expires_at=expires_at;assert.equal((await llamarVersiones(handler,'GET','token-a')).codigo,401);
    }
    db.tablas.sessions[0].expires_at=new Date(Date.now()+86400000).toISOString();
  });
  await probar('La biblioteca pagina sin descargar cuerpos y respeta la escena',async()=>{
    db.tablas.prompt_versions=[];
    for(let i=0;i<52;i++) assert.equal((await llamarVersiones(handler,'POST','token-a',{...datos,title:'Versión '+i})).codigo,201);
    const a=(await llamarVersiones(handler,'GET','token-a')).cuerpo;
    const b=(await llamarVersiones(handler,'GET','token-a',{}, {offset:'50'})).cuerpo;
    assert.equal(a.versiones.length,50);assert.equal(a.mas,true);assert.equal(b.versiones.length,2);assert.equal(b.mas,false);
    assert.equal(new Set([...a.versiones,...b.versiones].map(x=>x.id)).size,52);
    assert.equal((await llamarVersiones(handler,'GET','token-a',{}, {cat_id:'otra'})).cuerpo.versiones.length,0);
    assert.equal((await llamarVersiones(handler,'GET','token-a',{}, {offset:'-1'})).codigo,400);
  });
  await probar('Cada cuenta tiene un tope de versiones, sin afectar a las demás',async()=>{
    const propias=()=>db.tablas.prompt_versions.filter(v=>v.user_id==='cuenta-b').length;
    for(let i=propias();i<MAX_VERSIONES;i++) db.tablas.prompt_versions.push({id:'relleno-'+i,user_id:'cuenta-b',cat_id:'escena-prueba',variant:'prompt',title:'x',body:'__N__',revision:1});
    const r=await llamarVersiones(handler,'POST','token-b',datos);
    assert.equal(r.codigo,409);assert.equal(r.cuerpo.error,'version_limit');assert.equal(propias(),MAX_VERSIONES);
    const otra=await llamarVersiones(handler,'POST','token-a',datos);assert.equal(otra.codigo,201);
    db.tablas.prompt_versions=db.tablas.prompt_versions.filter(v=>!String(v.id).startsWith('relleno-') && v.id!==otra.cuerpo.version.id);
  });
  await probar('Retirar la escena no impide leer ni editar una copia propia',async()=>{
    const v=db.tablas.prompt_versions[0];db.tablas.categories=[];
    assert.equal((await llamarVersiones(handler,'GET','token-a',{}, {id:v.id})).codigo,200);
    assert.equal((await llamarVersiones(handler,'PUT','token-a',{...datos,revision:v.revision},{id:v.id})).codigo,200);
  });
  await probar('La migración faltante da un error recuperable',async()=>{
    db.errores.prompt_versions='PGRST205';assert.equal((await llamarVersiones(handler,'GET','token-a')).codigo,503);delete db.errores.prompt_versions;
  });
  await probar('El catálogo original nunca fue escrito',async()=>assert.deepEqual(db.tablas.prompt_bodies,original));
  console.log(`${cantidad} casos de permisos y guardado OK`);
  await verificarOrganizacion();
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  verificar().catch(e=>{console.error(e);process.exitCode=1;});
}
