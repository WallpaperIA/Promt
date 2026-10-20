#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { construirSitio, CSP } from './build-site.mjs';

const salida=await construirSitio(fileURLToPath(new URL('../build/site',import.meta.url)));
async function listar(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);out.push(...e.isDirectory()?await listar(p):[p]);}return out;}
const archivos=(await listar(salida)).map(p=>path.relative(salida,p));
assert.ok(!archivos.some(p=>/(?:^|\/)(?:api|scripts|supabase)(?:\/|$)|prompts|seed|\.env/i.test(p)));
const html=await readFile(path.join(salida,'index.html'),'utf8');
// El único script en línea es el del aviso de edad, en el <head> y con su
// hash en la CSP de esa página: sin 'unsafe-inline' ni un viaje bloqueante.
const enLinea=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(enLinea.length,1,'Sólo el aviso de edad queda en línea');
assert.ok(enLinea[0].index<html.indexOf('</head>'));
assert.match(enLinea[0][1],/wp_edad_v1/);
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
assert.ok(scripts.indexOf('data/catalog.js')<scripts.length-1);
// La CSP en <meta> apaga el preload scanner de Chromium: sin estas
// precargas los scripts del final se pedían de a uno (+0,8 s en celular).
const finHead=html.indexOf('</head>');
for(const src of scripts.filter(s=>html.indexOf('<script src="'+s+'">')>finHead))
  assert.ok(html.slice(0,finHead).includes('<link rel="preload" as="script" href="'+src+'">'),'Falta la precarga de '+src);
for(const src of scripts){new vm.Script(await readFile(path.join(salida,src.split('?')[0]),'utf8'));}
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
// Los scripts llevan el hash de su contenido en el nombre: pueden quedar en
// caché para siempre. Sin esto Vercel revalidaba en cada visita.
const inmutable=vercel.headers.find(h=>h.source==='/assets/app-(.*).js');
assert.ok(inmutable?.headers.some(h=>h.key==='Cache-Control'&&/immutable/.test(h.value)&&/max-age=31536000/.test(h.value)));
assert.ok(scripts.filter(p=>p.startsWith('assets/app-')).every(p=>/^assets\/app-[a-f0-9]{16}\.js$/.test(p)));
const workflow=await readFile(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
assert.ok(workflow.includes('node scripts/build-site.mjs _site'));
assert.ok(!workflow.includes('cp -r data'));
console.log('OK publicación con lista explícita, CSP, scripts externos y fuentes privadas excluidas');
