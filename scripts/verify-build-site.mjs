#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { construirSitio, CSP } from './build-site.mjs';

const salida=await construirSitio(fileURLToPath(new URL('../build/site',import.meta.url)));
async function listar(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);out.push(...e.isDirectory()?await listar(p):[p]);}return out;}
const archivos=(await listar(salida)).map(p=>path.relative(salida,p).split(path.sep).join('/'));
assert.ok(!archivos.some(p=>/(?:^|\/)(?:api|scripts|supabase)(?:\/|$)|prompts|seed|\.env/i.test(p)));
const referencias = archivos.filter(p=>p.startsWith('assets/prendas/')).sort();
const modificadores=await readFile(new URL('../data/modificadores.js',import.meta.url),'utf8');
const prendas=vm.runInNewContext(modificadores+'\nOUTFITS',{}, {timeout:1000});
const sinReferencia=new Set(['none','nothing','custom-outfit']);
const esperadas=Array.from(prendas.filter(prenda=>!sinReferencia.has(prenda.id)),prenda=>'assets/prendas/'+prenda.id+'.webp').sort();
const referenciasDeclaradas=Array.from(prendas.filter(prenda=>prenda.foto),prenda=>'assets/prendas/'+prenda.id+'.webp').sort();
assert.deepEqual(referenciasDeclaradas,esperadas,'Cada prenda del catálogo tiene una referencia');
assert.deepEqual(referencias,referenciasDeclaradas);
const referenciasOriginales=await readdir(new URL('../assets/prendas/',import.meta.url));
assert.deepEqual(referenciasOriginales.map(nombre=>'assets/prendas/'+nombre).sort(),referencias);
for(const foto of referencias){
  const imagen=await readFile(path.join(salida,foto));
  assert.equal(imagen.toString('ascii',8,12),'WEBP');
}
const html=await readFile(path.join(salida,'index.html'),'utf8');
// El único script en línea es el del aviso de edad, en el <head> y con su
// hash en la CSP de esa página: sin 'unsafe-inline' ni un viaje bloqueante.
const enLinea=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(enLinea.length,1,'Sólo el aviso de edad queda en línea');
assert.ok(enLinea[0].index<html.indexOf('</head>'));
assert.match(enLinea[0][1],/wp_edad_v1/);
// Precarga del catálogo con el sello del catalog.js que se publica al lado:
// con otro sello la URL no coincide con la de la página y se baja dos veces.
const selloPublicado=(await readFile(path.join(salida,'data/catalog.js'),'utf8')).match(/CATALOG_BUILT_AT\s*=\s*"([^"]+)"/)[1];
assert.ok(enLinea[0][1].includes(selloPublicado),'La precarga del catálogo lleva el sello publicado');
assert.ok(!html.includes('__SELLO_CATALOGO__'),'No queda la marca del sello sin reemplazar');
assert.ok(enLinea[0][1].includes('/api/catalog?desde=')&&enLinea[0][1].includes('/api/ejemplos?todas=1'),'El <head> precarga catálogo y lote');
assert.ok(!/<script\b(?![^>]*\bsrc=)(?!>)/i.test(html),'Ningún script en línea con atributos');
assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('<script'));
const cspPagina=html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
const hash="'sha256-"+createHash('sha256').update(enLinea[0][1],'utf8').digest('base64')+"'";
assert.ok(cspPagina.split(';').find(r=>r.trim().startsWith('script-src ')).includes(hash),'El hash del aviso de edad está en script-src');
// Lo que la CSP bloquearía sin avisar: manejadores en el HTML y javascript:.
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script>[\s\S]*?<\/script>/g,'')),'Sin manejadores on*= en el HTML');
assert.ok(!/href\s*=\s*["']?javascript:/i.test(html));
const scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)].map(m=>m[1]);
assert.equal(scripts.filter(p=>p.startsWith('assets/app-')).length,1);
const posCatalogo=scripts.findIndex(s=>s.split('?')[0]==='data/catalog.js');
assert.ok(posCatalogo>=0&&posCatalogo<scripts.length-1);
// Cada script y estilo local pedido por etiqueta lleva el hash de su
// contenido: Vercel los guarda un año y un cambio produce otra URL.
for(const m of html.matchAll(/(?:src|href)="((?:assets|data)\/[^"?]+\.(?:js|css))(\?[^"]*)?"/g)){
  if(m[1].startsWith('assets/app-'))continue;
  const h=createHash('sha256').update(await readFile(path.join(salida,m[1]))).digest('hex').slice(0,12);
  assert.equal(m[2],'?h='+h,'Versión por contenido de '+m[1]);
}
// Sin fuentes externas: el diseño usa la del sistema y la hoja de Google
// frenaba el primer dibujado.
assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html),'Sin Google Fonts en la página');
// La CSP en <meta> apaga el preload scanner de Chromium: sin estas
// precargas los scripts del final se pedían de a uno (+0,8 s en celular).
const finHead=html.indexOf('</head>');
for(const src of scripts.filter(s=>html.indexOf('<script src="'+s+'">')>finHead))
  assert.ok(html.slice(0,finHead).includes('<link rel="preload" as="script" href="'+src+'">'),'Falta la precarga de '+src);
for(const src of scripts){
  const archivo=path.join(salida,src.split('?')[0]);
  const etiqueta=[...html.matchAll(/<script\b[^>]*>/g)].find(m=>m[0].includes('src="'+src+'"'))?.[0]||'';
  if(/type=["']?module\b/.test(etiqueta))await import(pathToFileURL(archivo).href);
  else new vm.Script(await readFile(archivo,'utf8'));
}
const reglas=Object.fromEntries(CSP.split(';').map(r=>r.trim().split(/\s+/)).filter(r=>r[0]).map(([k,...v])=>[k,v]));
// Los destinos que la página usa de verdad. Sin gateway.umami.is el script
// de Umami cargaba pero ningún evento llegaba; sin el host de Supabase,
// Panel → Miniaturas no podía bajar las fotos firmadas para achicarlas.
for(const host of ['https://promt-iota.vercel.app','https://gateway.umami.is','https://auichymkshiljqdtysqm.supabase.co'])
  assert.ok(reglas['connect-src'].includes(host),'connect-src permite '+host);
assert.ok(reglas['img-src'].includes('https://auichymkshiljqdtysqm.supabase.co'));
assert.ok(reglas['script-src'].includes('https://cloud.umami.is'));
const umami=(await readFile(new URL('../index.html',import.meta.url),'utf8')).match(/s\.src = '(https:\/\/[^']+)'/);
assert.equal(new URL(umami[1]).origin,'https://cloud.umami.is','El script de métricas sale del host permitido');
assert.ok(!reglas['script-src'].includes("'unsafe-inline'"));
assert.ok(!reglas['script-src'].includes("'unsafe-eval'"));
assert.deepEqual(reglas['script-src-attr'],["'none'"]);
assert.deepEqual(reglas['object-src'],["'none'"]);
const vercel=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
assert.equal(vercel.outputDirectory,'build/site');
assert.ok(vercel.headers[0].headers.some(h=>h.key==='X-Content-Type-Options'&&h.value==='nosniff'));
for(const ruta of ['/','/index.html']){
  assert.ok(vercel.headers.find(h=>h.source===ruta)?.headers.some(h=>h.key==='Cache-Control'&&h.value==='public, max-age=0, must-revalidate'),'El HTML debe comprobar si hay una versión nueva');
}
// Los scripts llevan el hash de su contenido en el nombre: pueden quedar en
// caché para siempre. Sin esto Vercel revalidaba en cada visita.
const inmutable=vercel.headers.find(h=>h.source==='/assets/app-(.*).js');
assert.ok(inmutable?.headers.some(h=>h.key==='Cache-Control'&&/immutable/.test(h.value)&&/max-age=31536000/.test(h.value)));
assert.ok(scripts.filter(p=>p.startsWith('assets/app-')).every(p=>/^assets\/app-[a-f0-9]{16}\.js$/.test(p)));
// Caché de un año sólo con ?h=: lo que pide el código sin esa marca se
// sigue revalidando, así un olvido de versión nunca queda pegado.
const versionados=vercel.headers.find(h=>h.source==='/(assets|data)/(.*)');
assert.deepEqual(versionados?.has,[{type:'query',key:'h'}],'La caché larga exige ?h=');
assert.ok(versionados.headers.some(h=>h.key==='Cache-Control'&&/immutable/.test(h.value)&&/max-age=31536000/.test(h.value)));
assert.ok(!/googleapis|gstatic/.test(CSP),'La CSP ya no permite Google Fonts');
const workflow=await readFile(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
assert.ok(workflow.includes('node scripts/build-site.mjs _site'));
assert.ok(!workflow.includes('cp -r data'));
console.log('OK publicación con lista explícita, CSP, scripts externos y fuentes privadas excluidas');
