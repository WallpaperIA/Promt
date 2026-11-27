#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ipDe, limitar } from '../api/_limite.js';

// El tope por dispositivo de api/_limite.js y la ruta de versiones y ajustes.
// Catálogo, prompts, fotos y sesión lo prueban sus propias verificaciones
// (verify-catalogo-api, verify-api-lectura, verify-seguridad). Todo con
// pedidos sintéticos: no se llama a ningún servicio.

let casos = 0;
const problemas = [];
async function probar(nombre, fn) {
  try { await fn(); casos++; }
  catch (e) { problemas.push({ nombre, mensaje: e.message }); }
}
function respuesta() {
  return { codigo: 200, cabeceras: {}, cuerpo: undefined,
    setHeader(k, v) { this.cabeceras[k.toLowerCase()] = v; },
    status(c) { this.codigo = c; return this; }, json(c) { this.cuerpo = c; return this; }, end() { return this; } };
}
const desde = (ip) => ({ method: 'GET', query: {}, headers: ip ? { 'x-real-ip': ip } : {} });

await probar('la IP sale de las cabeceras de Vercel y la primera de la lista', () => {
  assert.equal(ipDe(desde('203.0.113.7')), '203.0.113.7');
  assert.equal(ipDe({ headers: { 'x-forwarded-for': '203.0.113.8, 10.0.0.1' } }), '203.0.113.8');
  assert.equal(ipDe({ headers: { 'x-vercel-forwarded-for': '203.0.113.10' } }), '203.0.113.10');
  assert.equal(ipDe({ headers: { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' } }), '203.0.113.9');
  assert.equal(ipDe({ headers: {} }), '');
  assert.equal(ipDe({}), '');
});

await probar('en IPv6 cuenta el bloque /64, escrito de cualquier forma', () => {
  const bloque = ipDe(desde('2001:db8:0:0:aaaa:bbbb:cccc:dddd'));
  assert.equal(bloque, '2001:db8:0:0::/64');
  for (const ip of ['2001:db8::1', '2001:DB8::2', '2001:0db8:0000:0000::5:9', '2001:db8:0:0::']) assert.equal(ipDe(desde(ip)), bloque, ip);
  assert.notEqual(ipDe(desde('2001:db8:0:1::1')), bloque);
  assert.equal(ipDe(desde('::ffff:203.0.113.7')), '203.0.113.7', 'Una IPv4 escrita como IPv6');
  assert.equal(ipDe(desde('::')), '0:0:0:0::/64');
});

await probar('al pasar el tope responde 429 con Retry-After, por ruta y por dispositivo', () => {
  const t = 1_000_000;
  for (let n = 1; n <= 5; n++) assert.equal(limitar(desde('192.0.2.1'), respuesta(), 'prueba-a', 5, t + n), false);
  const res = respuesta();
  assert.equal(limitar(desde('192.0.2.1'), res, 'prueba-a', 5, t + 10_000), true);
  assert.equal(res.codigo, 429);
  // La ventana empezó con el primer pedido (t + 1) y termina un minuto después.
  assert.equal(res.cabeceras['retry-after'], '51');
  assert.equal(res.cabeceras['cache-control'], 'private, no-store');
  assert.deepEqual(res.cuerpo, { error: 'demasiados_pedidos', reintentar: 51 });
  assert.equal(limitar(desde('192.0.2.2'), respuesta(), 'prueba-a', 5, t + 10_000), false, 'Otro dispositivo tiene su propia cuenta');
  assert.equal(limitar(desde('192.0.2.1'), respuesta(), 'prueba-b', 5, t + 10_000), false, 'Otra ruta tiene su propia cuenta');
});

await probar('la cuenta vuelve a cero al minuto', () => {
  const t = 5_000_000;
  for (let n = 0; n < 3; n++) assert.equal(limitar(desde('192.0.2.3'), respuesta(), 'prueba-c', 3, t), false);
  assert.equal(limitar(desde('192.0.2.3'), respuesta(), 'prueba-c', 3, t + 59_999), true);
  assert.equal(limitar(desde('192.0.2.3'), respuesta(), 'prueba-c', 3, t + 60_000), false);
});

await probar('sin IP no se limita (servidor local y pruebas)', () => {
  for (let n = 0; n < 50; n++) assert.equal(limitar(desde(''), respuesta(), 'prueba-d', 1), false);
});

await probar('con muchísimas IP distintas la memoria no crece sin límite', () => {
  const t = 9_000_000;
  assert.equal(limitar(desde('192.0.2.4'), respuesta(), 'prueba-e', 1, t), false);
  assert.equal(limitar(desde('192.0.2.4'), respuesta(), 'prueba-e', 1, t), true);
  // 20 001 dispositivos más en la misma ventana: sin ventanas vencidas que
  // borrar, la tabla se vacía antes que seguir creciendo.
  for (let i = 0; i <= 20_000; i++) limitar(desde('10.' + (i >> 16) + '.' + ((i >> 8) & 255) + '.' + (i & 255)), respuesta(), 'prueba-e', 1, t);
  assert.equal(limitar(desde('192.0.2.4'), respuesta(), 'prueba-e', 1, t), false);
});

// api/versiones.js reparte entre Mis versiones y los ajustes de la cuenta.
function cargarVersiones() {
  const ruta = new URL('../api/versiones.js', import.meta.url);
  const fuente = readFileSync(ruta, 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default function handler(', 'function handler(');
  const atendidos = [];
  const atender = (nombre) => () => (req, res) => { atendidos.push(nombre); return res.status(200).json({ ok: nombre }); };
  const fabrica = vm.compileFunction(fuente + '\nreturn handler;',
    ['createClient', 'crearHandlerVersiones', 'crearHandlerAjustes', 'limitar', 'process'], { filename: ruta.pathname });
  return { atendidos, handler: fabrica(() => ({}), atender('versiones'), atender('ajustes'), limitar, { env: {} }) };
}

await probar('versiones y ajustes llevan cada uno su tope y el preflight no cuenta', async () => {
  const { atendidos, handler } = cargarVersiones();
  const pedido = (query, method = 'GET') => ({ method, query, headers: { 'x-real-ip': '192.0.2.50' } });
  for (let n = 0; n < 120; n++) { const r = respuesta(); await handler(pedido({}), r); assert.equal(r.codigo, 200); }
  const cortado = respuesta(); await handler(pedido({}), cortado);
  assert.equal(cortado.codigo, 429);
  assert.equal(atendidos.length, 120, 'El rechazo no llega a Mis versiones');
  for (let n = 0; n < 120; n++) { const r = respuesta(); await handler(pedido({ ajustes: '1' }), r); assert.equal(r.codigo, 200); }
  assert.equal(atendidos.filter((a) => a === 'ajustes').length, 120, 'Ajustes tiene su propia cuenta');
  const ajustes = respuesta(); await handler(pedido({ ajustes: '1' }), ajustes);
  assert.equal(ajustes.codigo, 429);
  const preflight = respuesta(); await handler(pedido({}, 'OPTIONS'), preflight);
  assert.equal(preflight.codigo, 200, 'El preflight no se cuenta ni se corta');
});

// Cada ruta pública pasa por el tope; un archivo que lo pierda en un cambio
// queda a la vista acá. Las de administración y el webhook no: el panel
// recorre cientos de fotos por minuto, y el webhook lo firma Patreon.
await probar('las rutas públicas usan el tope', () => {
  const rutas = { 'catalog.js': ['catalogo'], 'prompt.js': ['prompt', 'prompt-todas'], 'ejemplos.js': ['fotos', 'fotos-todas'],
    'auth/verify.js': ['verify'], 'auth/login.js': ['entrar'], 'auth/logout.js': ['salir'] };
  for (const [archivo, nombres] of Object.entries(rutas)) {
    const fuente = readFileSync(new URL('../api/' + archivo, import.meta.url), 'utf8');
    assert.match(fuente, /^import \{ limitar \} from '\.\.?\/(\.\.\/)?_limite\.js';$/m, archivo);
    for (const nombre of nombres) assert.match(fuente, new RegExp("limitar\\(req, res, '" + nombre + "', \\d+\\)"), archivo + ' / ' + nombre);
  }
});

console.log(casos + ' casos del tope por dispositivo OK');
for (const p of problemas) console.error('FALLO: ' + p.nombre + '\n' + p.mensaje);
if (problemas.length) process.exitCode = 1;
