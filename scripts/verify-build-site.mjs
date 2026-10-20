#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { construirSitio, CSP } from './build-site.mjs';

const salida=await construirSitio(new URL('../build/site',import.meta.url).pathname);
async function listar(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);out.push(...e.isDirectory()?await listar(p):[p]);}return out;}
const archivos=(await listar(salida)).map(p=>path.relative(salida,p));
assert.ok(!archivos.some(p=>/(?:^|\/)(?:api|scripts|supabase)(?:\/|$)|prompts|seed|\.env/i.test(p)));
const html=await readFile(path.join(salida,'index.html'),'utf8');
assert.ok(!/<script\b(?![^>]*\bsrc=)/i.test(html));
assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('<script'));
const scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)].map(m=>m[1]);
assert.equal(scripts.filter(p=>p.startsWith('assets/app-')).length,2);
assert.ok(scripts.indexOf('data/catalog.js')<scripts.length-1);
for(const src of scripts){new vm.Script(await readFile(path.join(salida,src.split('?')[0]),'utf8'));}
const reglas=Object.fromEntries(CSP.split(';').map(r=>r.trim().split(/\s+/)).filter(r=>r[0]).map(([k,...v])=>[k,v]));
assert.ok(!reglas['script-src'].includes("'unsafe-inline'"));
assert.ok(!reglas['script-src'].includes("'unsafe-eval'"));
assert.deepEqual(reglas['script-src-attr'],["'none'"]);
assert.deepEqual(reglas['object-src'],["'none'"]);
const vercel=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
assert.equal(vercel.outputDirectory,'build/site');
assert.ok(vercel.headers[0].headers.some(h=>h.key==='X-Content-Type-Options'&&h.value==='nosniff'));
const workflow=await readFile(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
assert.ok(workflow.includes('node scripts/build-site.mjs _site'));
assert.ok(!workflow.includes('cp -r data'));
console.log('OK publicación con lista explícita, CSP, scripts externos y fuentes privadas excluidas');
