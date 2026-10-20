#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const leer=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fuente=leer('data/modificadores.js'),catalogo=leer('data/catalog.js'),html=leer('index.html');
const server=vm.createContext({});
new vm.Script(fuente+';globalThis.listas={STYLES,OUTFITS,HAIRSTYLES,FORMATS,DETAILS};').runInContext(server);
assert.deepEqual(Object.fromEntries(Object.entries(server.listas).map(([k,v])=>[k,v.length])),{STYLES:20,OUTFITS:92,HAIRSTYLES:20,FORMATS:6,DETAILS:37});
for(const [nombre,lista]of Object.entries(server.listas)){
  assert.equal(new Set(lista.map(x=>x.id)).size,lista.length,nombre+' tiene IDs repetidos');
  for(const x of lista){
    assert(/^[a-z0-9-]+$/.test(x.id));assert(typeof x.name==='string');
    if(nombre!=='DETAILS')assert(typeof x.desc==='string');
    assert(!/[\u{1F300}-\u{1FAFF}]/u.test(x.name+(x.desc||'')));
    if(x.tier)assert(['free','premium','full'].includes(x.tier));
    if(nombre==='STYLES')assert(x.prefix&&typeof x.prefix==='string');
  }
}
// Regla 2 del anime (CLAUDE.md): toda prenda que deja ver piel lleva
// revela:true. Se buscan las palabras con que se describen en inglés; una
// prenda nueva que las use sin la marca hace fallar esto. crop-white
// ("bare stomach"), athletic-set ("sports bra"), scarf-top-jeans ("open
// back"), shirt-oversize y sweater-knit (una sola prenda que cae de un
// hombro) se colaron así con un estilo de ilustración.
const DEJA_VER=/\b(bare|midriff|stomach|sports bra|bikini|bralette|lingerie|sheer|see-through|mesh|fishnet|lace|tulle|voile|chiffon|cut-?outs?|open back|open upper back|backless|plunging|deep[- ]v|deep[- ]u|off one shoulder|slipping off|corset|bustier|bodysuit|bodystocking|babydoll|nightgown|robe|bed ?sheet|nothing|swimsuit|unitard)\b/i;
// Las retiradas no se ofrecen (PRENDAS_RETIRADAS en index.html).
const noOfrecidas=new Set(JSON.parse(html.match(/const PRENDAS_RETIRADAS=new Set\((\[[^\]]*\])\)/)[1]));
const sinMarca=server.listas.OUTFITS.filter(o=>!noOfrecidas.has(o.id)&&o.instruction&&DEJA_VER.test(o.instruction)&&!o.revela)
  .map(o=>o.id+': '+o.instruction.match(DEJA_VER)[0]);
// La lista viene del contexto del vm: se copia para comparar arreglos.
assert.deepEqual([...sinMarca],[],'Prendas que dejan ver piel sin revela:true');
for(const id of ['crop-white','athletic-set','scarf-top-jeans','shirt-oversize','sweater-knit'])
  assert.equal(server.listas.OUTFITS.find(o=>o.id===id).revela,true,id);
const browser=vm.createContext({document:{}});
new vm.Script(catalogo+';globalThis.antes=JSON.stringify({CATEGORIES,CATALOG_BUILT_AT});').runInContext(browser);
new vm.Script(fuente).runInContext(browser);
const inicio=html.indexOf('if(globalThis.WP_MODIFICADORES){'),fin=html.indexOf('// ── Mis personajes',inicio);
assert(inicio>=0&&fin>inicio);new vm.Script(html.slice(inicio,fin)).runInContext(browser);
new vm.Script(html.match(/const PEINADOS =[^;]+;/)[0]).runInContext(browser);
new vm.Script('globalThis.despues=JSON.stringify({CATEGORIES,CATALOG_BUILT_AT});globalThis.total=STYLES.length;globalThis.prendas=JSON.stringify(OUTFITS);globalThis.peinados=JSON.stringify(PEINADOS);').runInContext(browser);
assert.equal(browser.antes,browser.despues);assert.equal(browser.total,20);
assert.equal(browser.peinados,JSON.stringify(server.listas.HAIRSTYLES),'El selector debe recibir el peinado nuevo sin regenerar el catálogo.');
const retiradas=['balconette-bustier-set','organza-bustier-set','mesh-bandeau-set','illusion-dress','tulle-panel-bodysuit','modern-kimono','holo-jacket','metallic-dress','lace-emerald','blazer-black','wrap-neckline-dress','wide-armhole-top-set','one-shoulder-bodysuit','keyhole-top-set','bandeau-dress','sweetheart-top-set','wrap-top-long-skirt','leather-look-dress','short-unitard','waist-cutout-dress','satin-bustier-skirt','velvet-bodysuit','ruched-jersey-dress','bias-satin-dress','ribbed-bodysuit','blazer-tailored-shorts','satin-short-pajamas','asymmetric-knit-dress','silk-blouse','pleated-dress','leather-jacket','techwear-set','wool-coat','tailored-suit'];
assert.equal(retiradas.length,34);
const activas=JSON.parse(browser.prendas);
assert.equal(activas.length,58,'Quedan 57 prendas y Original');
assert.equal(browser.prendas,JSON.stringify(server.listas.OUTFITS.filter(o=>!retiradas.includes(o.id))),'El arranque conserva las prendas actuales sin regenerar las escenas.');
for(const id of retiradas)assert.ok(!activas.some(o=>o.id===id),'Prenda solicitada fuera del selector: '+id);
assert.ok(activas.some(o=>o.id==='sheer-camisola'));
// Si falla o queda viejo el archivo de modificadores, las copias del
// catálogo anterior tampoco deben devolver prendas que se retiraron.
const anterior=vm.createContext({});
vm.runInContext(catalogo+'\n'+html.slice(inicio,fin)+'\nthis.prendas=OUTFITS.map(o=>o.id);',anterior);
for(const id of retiradas)assert.ok(!anterior.prendas.includes(id),'La copia anterior no recupera '+id);
const a=html.indexOf('function aplicarMedioArtistico('),b=html.indexOf('\nconst KEY_FORMAT',a);
new vm.Script(html.slice(a,b)+';globalThis.aplicar=aplicarMedioArtistico;').runInContext(browser);
for(const id of retiradas)assert.equal(browser.prendaPara('playboy',id),'none','Una elección retirada vuelve a Original: '+id);
assert.equal(browser.prendaPara('playboy','id-desconocido'),'none');
assert.equal(browser.prendaPara('playboy','sheer-camisola'),'sheer-camisola');
console.log('OK 34 prendas retiradas, caché anterior filtrada y elecciones retiradas en Original');
// Ocho referencias individuales, once cortes del collage y tres ideas
// adicionales. Se comprueba el lote entero, no sólo una muestra del envío.
const nuevas=[
  'voile-button-shirt','black-mesh-cargo-set','zip-ruched-unitard',
  'embroidered-tulle-babydoll','plumetis-tulle-minidress','fine-net-halter-bodysuit',
  'ruffled-tulle-set','lace-trim-sheer-chemise','cross-neck-lace-bodysuit',
  'diamond-net-bodysuit','high-neck-microtulle-bodysuit','floral-lace-bodystocking',
  'contrast-trim-mesh-bodysuit','cap-sleeve-lace-bodysuit','lace-up-mesh-bodysuit',
  'hexagon-mesh-bodysuit','side-cutout-mesh-bodysuit','lace-band-mesh-bodystocking',
  'lace-neckline-mesh-bodysuit','square-neck-microtulle-bodysuit','voile-shirt-bodysuit',
  'draped-tulle-top',
];
assert.equal(nuevas.length,22);
const ilustrados=server.listas.STYLES.filter(s=>s.medium==='illustration');
for(const id of nuevas){
  const prenda=activas.find(o=>o.id===id);
  assert.ok(prenda,'Referencia incluida: '+id);
  assert.equal(prenda.tier,'full');assert.equal(prenda.revela,true);
  assert.ok(prenda.instruction.includes('every adult character'));
  assert.ok(prenda.instruction.includes('Keep the chest and pelvis covered.'));
  assert.ok(prenda.instruction.includes('Preserve all identities, body proportions, poses, expressions, hair, background, lighting and framing.'));
  assert.equal(browser.prendaPara('playboy',id),id);
  for(const estilo of ilustrados)assert.equal(browser.prendaPara(estilo.id,id),'none');
}
assert.equal(new Set(activas.map(o=>o.name)).size,activas.length,'Nombres de prendas distintos en el selector');
console.log('OK las 22 prendas nuevas se cargan sin regenerar escenas, con Full y límites de ilustración');
const original='Original de __N1__ y __N2__. 9:16 4K. Extras: visible skin pores.';
for(const estilo of server.listas.STYLES){
  const texto=browser.aplicar(original,estilo.id);
  assert(texto.startsWith(original));assert(texto.includes('__N1__')&&texto.includes('__N2__'));
  if(estilo.medium==='illustration')assert(texto.includes('overrides inherited photographic rendering instructions'));
  if(!estilo.instruction)assert.equal(texto,original);
}
const workflow=leer('.github/workflows/pages.yml');
const {construirSitio}=await import('./build-site.mjs');
await construirSitio(fileURLToPath(new URL('../build/site',import.meta.url)));
assert.equal(leer('build/site/data/modificadores.js'),leer('data/modificadores.js'));
assert(!/cp\s+(?:-r\s+)?data\/?\s/.test(workflow));
console.log('Modificadores: listas válidas, IDs únicos, VM y navegador compatibles; catálogo y sello intactos.');
