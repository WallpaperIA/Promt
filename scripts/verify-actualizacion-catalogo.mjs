#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Ejecuta la fusión y la actualización reales con un catálogo móvil antiguo.
// La ficha abierta representa nombres, variante y borrador que no se pueden
// perder al incorporar lo publicado desde otro dispositivo.
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fusion=html.slice(html.indexOf('    async function fusionarCatalogo('),html.indexOf('    /** El delta del servidor'));
const actualizar=html.slice(html.indexOf('// ── Actualización del catálogo al volver al móvil'),html.indexOf('// ── Init'));
assert.ok(fusion && actualizar);
const categoria=i=>({id:'escena-'+i,name:'Escena '+i,sub:'Ficha sintética',tier:'editorial',ready:true,status:'publicada',sortOrder:i,variants:['prompt','duoPrompt','trioPrompt']});

class Fila {
  constructor(cat,abierta=false){this.dataset={id:cat.id};this.abierta=abierta;this.parent=null;this.body={nombre:'Modelo ficticia',variante:'trio',borrador:'Texto en edición'};}
  get nextElementSibling(){const a=this.parent?.children||[];return a[a.indexOf(this)+1]||null;}
  querySelector(s){return s==='.section.open' && this.abierta ? this.body : null;}
  contains(n){return n===this || n===this.body;}
  remove(){if(this.parent){const a=this.parent.children;a.splice(a.indexOf(this),1);this.parent=null;}}
  replaceWith(n){const p=this.parent,i=p.children.indexOf(this);p.children[i]=n;n.parent=p;this.parent=null;}
}
function pagina(){
  const listeners={window:{},document:{}},timers=new Map(),boton={disabled:false,textContent:'Actualizar catálogo',addEventListener(t,fn){this[t]=fn;}};
  const cats=Array.from({length:409},(_,i)=>categoria(i));
  const acc={children:cats.map((c,i)=>new Fila(c,i===5)),querySelectorAll(){return this.children;},get firstElementChild(){return this.children[0]||null;},
    insertBefore(n,ref){n.remove();const i=ref?this.children.indexOf(ref):this.children.length;assert.ok(i>=0);this.children.splice(i,0,n);n.parent=this;}};
  acc.children.forEach(f=>f.parent=acc);
  const abierta=acc.children[5], datos={categorias:Array.from({length:431},(_,i)=>categoria(i)),conEjemplos:[],gratis:[],eliminadas:[]};
  let reloj=100000, siguiente=0, respuesta=()=>Promise.resolve(datos);
  const ctx={CATEGORIES:cats,acc,catalogoRecibido:true,arranqueCatalogo:Promise.resolve(),AbortController,
    Date:{now:()=>reloj},Promise,Set,Map,Event,_detached:{sec:abierta.body},_promptCache:{},
    document:{hidden:false,activeElement:abierta.body,getElementById:()=>boton,addEventListener(t,fn){listeners.document[t]=fn;},dispatchEvent(){ctx.avisos++;}},
    window:{__conEjemplos:new Set(),__gratis:new Set(),__destacadas:[],addEventListener(t,fn){listeners.window[t]=fn;}},
    setTimeout(fn,ms){timers.set(++siguiente,{fn,ms});return siguiente;},clearTimeout(id){timers.delete(id);},
    getSortedCategories:()=>ctx.CATEGORIES.filter(c=>c.id!=='oculta'),getStats:()=>({}),getFavs:()=>['escena-5'],
    buildSection:(cat)=>{ctx.creadas++;return new Fila(cat);},clearDetail:()=>{ctx.limpiezas++;},
    applyFilters:()=>{ctx.filtros++;},updateStats:()=>{ctx.stats++;},cargarDestacadas:()=>{},mostrarAdministracion:()=>{},_savePromptCache:()=>{},
    pedirCatalogo:op=>{ctx.pedidos.push(op);return respuesta(op);},showToast:mensaje=>ctx.toasts.push(mensaje),
    avisos:0,creadas:0,limpiezas:0,filtros:0,stats:0,pedidos:[],toasts:[]};
  vm.createContext(ctx);vm.runInContext(fusion+actualizar,ctx);
  return {ctx,acc,abierta,boton,timers,listeners,datos,setRespuesta:f=>{respuesta=f;},avanzar:ms=>{reloj+=ms;},
    async evento(destino,tipo,e={}){listeners[destino][tipo](e);await vm.runInContext('actualizacionCatalogo',ctx);}};
}

const p=pagina(), cuerpo=p.abierta.body;
await p.ctx.actualizarCatalogo({manual:true});
assert.equal(p.ctx.CATEGORIES.length,431,'El móvil recibe las 22 fichas nuevas');
assert.equal(p.acc.children.length,431);
assert.equal(new Set(p.acc.children.map(f=>f.dataset.id)).size,431);
assert.deepEqual(p.acc.children.map(f=>f.dataset.id),p.ctx.CATEGORIES.map(c=>c.id));
assert.equal(p.acc.children[5],p.abierta,'Se conserva el nodo abierto');
assert.equal(p.abierta.body,cuerpo);
assert.deepEqual(cuerpo,{nombre:'Modelo ficticia',variante:'trio',borrador:'Texto en edición'});
assert.equal(p.ctx.limpiezas,0);assert.equal(p.ctx.creadas,22);
assert.equal(p.ctx.pedidos[0].actualizar,true);
assert.equal(p.boton.disabled,false);assert.equal(p.boton.textContent,'Actualizar catálogo');

const escritos=p.ctx.stats;
await p.ctx.actualizarCatalogo({manual:true});
assert.equal(p.ctx.stats,escritos,'Una respuesta idéntica no reconstruye la lista');
assert.equal(p.ctx.creadas,22);

const antes=p.ctx.pedidos.length;
await p.evento('window','focus');
await p.evento('document','visibilitychange');
assert.equal(p.ctx.pedidos.length,antes,'Se agrupan las señales consecutivas al volver');
p.avanzar(60001);p.ctx.document.hidden=true;
await p.evento('document','visibilitychange');assert.equal(p.ctx.pedidos.length,antes);
p.ctx.document.hidden=false;
await p.evento('document','visibilitychange');assert.equal(p.ctx.pedidos.length,antes+1);
await p.evento('window','pageshow',{persisted:true});assert.equal(p.ctx.pedidos.length,antes+2,'Atrás desde la caché pide datos actuales');
await p.evento('window','pageshow',{persisted:false});assert.equal(p.ctx.pedidos.length,antes+2);
await p.evento('window','online');assert.equal(p.ctx.pedidos.length,antes+3,'Recuperar la conexión permite reintentar');

const fallo=pagina();fallo.setRespuesta(()=>Promise.reject(new Error('sin red')));
assert.equal(await fallo.ctx.actualizarCatalogo({manual:true}),false);
assert.equal(fallo.acc.children.length,409);assert.equal(fallo.ctx.limpiezas,0);
assert.equal(fallo.boton.disabled,false);assert.match(fallo.ctx.toasts[0],/No se pudo actualizar/);
fallo.setRespuesta(()=>Promise.resolve(fallo.datos));
await fallo.evento('window','online');assert.equal(fallo.acc.children.length,431);

const lentitud=pagina();let avisarPedido;
const pedidoIniciado=new Promise(resolve=>{avisarPedido=resolve;});
lentitud.setRespuesta(op=>new Promise((resolve,reject)=>{avisarPedido();op.signal.addEventListener('abort',()=>reject(new Error('abortado')));}));
const primera=lentitud.ctx.actualizarCatalogo({manual:true}),segunda=lentitud.ctx.actualizarCatalogo({manual:true});
assert.equal(primera,segunda,'Un solo pedido para clics o eventos simultáneos');
await pedidoIniciado;
assert.equal(lentitud.ctx.pedidos.length,1);
assert.equal(lentitud.boton.disabled,true);
for(const {fn,ms} of [...lentitud.timers.values()]) if(ms===12000) fn();
assert.equal(await primera,false,'Un pedido detenido no bloquea el botón indefinidamente');
assert.equal(lentitud.boton.disabled,false);assert.equal(lentitud.acc.children.length,409);

assert.match(html,/id="catalogo-actualizar"/);
console.log('OK catálogo móvil 409→431, ficha abierta conservada, revalidación, errores, recuperación y tiempo límite');
