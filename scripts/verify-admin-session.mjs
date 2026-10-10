#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { applyCors } from '../api/_cors.js';

// Se ejecuta el handler real con filas sintéticas: así la prueba no necesita
// credenciales ni puede modificar las cuentas de producción.
const fuente = readFileSync(new URL('../api/auth/verify.js', import.meta.url), 'utf8');
const futuro = new Date(Date.now() + 86400000).toISOString();
const cuentas = {
  admin: { expires_at: futuro, users: { id: 'admin', tier: 'free', is_admin: true, full_name: 'Admin sintético' } },
  vip: { expires_at: futuro, users: { id: 'vip', tier: 'full', is_admin: false, full_name: 'VIP sintético', tier_checked_at: new Date().toISOString() } },
  vencida: { expires_at: '2000-01-01T00:00:00Z', users: { is_admin: true } },
};
const contexto = vm.createContext({
  process: { env: {} }, applyCors, console,
  revalidarTier: async () => { throw new Error('No debería revalidar estas cuentas'); },
  createClient: () => ({ from: () => ({ select: () => ({ eq: (_, token) => ({ single: async () => ({ data: cuentas[token] ?? null, error: null }) }) }) }) }),
});
vm.runInContext(fuente.replace(/^import .*;\n/gm, '').replace('export default async function handler', 'async function handler'), contexto);
async function verificar(token, extra = {}) {
  const res = { codigo: 200, cabeceras: {}, setHeader(k, v) { this.cabeceras[k] = v; }, status(c) { this.codigo = c; return this; }, json(c) { this.cuerpo = c; return this; } };
  await contexto.handler({ method: 'POST', headers: {}, body: { token, ...extra } }, res);
  return res;
}
const admin = await verificar('admin');
assert.equal(admin.cuerpo.tier, 'full');
assert.equal(admin.cuerpo.esAdmin, true);
assert.deepEqual(Object.keys(admin.cuerpo).sort(), ['esAdmin', 'name', 'tier']);
assert.equal(admin.cabeceras['Cache-Control'], 'private, no-store');
const vip = await verificar('vip', { is_admin: true, esAdmin: true, tier: 'full' });
assert.equal(vip.cuerpo.tier, 'full');
assert.equal(vip.cuerpo.esAdmin, false);
for (const token of ['vencida', 'inexistente']) {
  const res = await verificar(token);
  assert.equal(res.codigo, 401);
  assert.equal(res.cuerpo.esAdmin, undefined);
}
console.log('OK el permiso sale de la sesión; VIP, sesión vencida y campos del cliente no habilitan administración');

// La caché anónima reproduce la visita previa al login. Se carga la función
// del HTML, no una copia, para detectar si vuelve a reutilizar esa respuesta.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mostrar = html.slice(html.indexOf('function mostrarAdministracion('), html.indexOf('// Access tier:'));
const fusionar = html.slice(html.indexOf('async function fusionarCatalogo('), html.indexOf('async function ensurePrompts('));
let habilitaciones = 0;
const browser = vm.createContext({
  window: { habilitarPanelAdmin: () => { habilitaciones++; } },
  localStorage: { getItem: () => 'token-sintético' },
  KEY_SESSION: 'sesion', API_BASE: '', CATALOG_BUILT_AT: '', CATEGORIES: [],
  fetch: async (_, opciones) => ({ ok: true, json: async () => ({ esAdmin: opciones.cache === 'no-store', categorias: [], gratis: [], conEjemplos: ['foto-nueva'] }) }),
});
vm.runInContext(mostrar + '\n' + fusionar, browser);
await browser.fusionarCatalogo();
assert.equal(browser.window.__wpEsAdmin, true);
assert.equal(browser.window.__conEjemplos.has('foto-nueva'), true);
assert.equal(habilitaciones, 1);
delete browser.window.__wpEsAdmin;
browser.fetch = async () => { throw new Error('Catálogo no disponible'); };
assert.equal(await browser.fusionarCatalogo(), false);
browser.mostrarAdministracion(admin.cuerpo);
assert.equal(browser.window.__wpEsAdmin, true);
delete browser.window.__wpEsAdmin;
browser.mostrarAdministracion(vip.cuerpo);
browser.mostrarAdministracion({ esAdmin: 'true' });
assert.equal(browser.window.__wpEsAdmin, undefined);
console.log('OK el catálogo autenticado evita la caché anónima y la sesión habilita el panel aunque falle el catálogo');
