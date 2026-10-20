#!/usr/bin/env node
// Actualiza las copias públicas de respaldo sin leer los cuerpos privados ni
// regenerar las escenas: perder el archivo de modificadores no revive reglas viejas.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const LISTAS=['STYLES','OUTFITS'];
function cargar(codigo,expresion){
  const contexto=vm.createContext({});
  vm.runInContext(codigo+';globalThis.resultado='+expresion,contexto);
  return JSON.parse(JSON.stringify(contexto.resultado));
}
export function sincronizarModificadores(catalogo,fuente){
  const metadata=c=>cargar(c,'({CATEGORIES,CATALOG_BUILT_AT})');
  const antes=metadata(catalogo);
  const listas=cargar(fuente,'({STYLES,OUTFITS})');
  let resultado=catalogo;
  for(const nombre of LISTAS){
    const patron=new RegExp('^const '+nombre+' = [^\\n]+;','m');
    assert.ok(patron.test(resultado),'No se encontró la lista pública '+nombre);
    resultado=resultado.replace(patron,()=>`const ${nombre} = ${JSON.stringify(listas[nombre])};`);
  }
  assert.deepEqual(metadata(resultado),antes,'Se conservan las escenas y el sello');
  return resultado;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const catalogo=new URL('../data/catalog.js',import.meta.url);
  const fuente=fs.readFileSync(new URL('../data/modificadores.js',import.meta.url),'utf8');
  const antes=fs.readFileSync(catalogo,'utf8');
  const despues=sincronizarModificadores(antes,fuente);
  if(despues!==antes)fs.writeFileSync(catalogo,despues);
  console.log('Estilos y prendas públicos sincronizados; escenas y sello intactos.');
}
