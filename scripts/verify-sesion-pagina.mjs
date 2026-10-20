#!/usr/bin/env node
// Ejecuta el bloque real de sesión de index.html (verify, marca de sesión,
// reintento ante 403 y vuelta con Atrás) con fetch y almacenamiento
// simulados. No hay credenciales: la cookie la maneja el navegador y acá
// sólo importa qué hace la página con cada respuesta.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extraer(inicios, fin) {
  const inicio = inicios.find(i => html.includes(i));
  const a = html.indexOf(inicio), b = html.indexOf(fin, a);
  assert.ok(a >= 0 && b > a, 'No se encontró ' + inicios[0]);
  return html.slice(a, b);
}
const bloqueSesion = extraer(['    // La marca con la que se dibujó', '    async function _verifyPatreonSession(){'],
  '    // La sesión y el catálogo pueden responder');
const bloqueAtras = extraer(["    window.addEventListener('pageshow'"], '\n\n');

function pagina({ origen = 'cuenta', local = {}, respuestas = [] } = {}) {
  const m = new Map(Object.entries(local));
  const oyentes = {};
  const ctx = {
    API_BASE: origen === 'cuenta' ? '' : 'https://promt-iota.vercel.app',
    KEY_SESSION: 'wp_session_id_v1', KEY_PATREON_TIER: 'wp_ptier_v1', KEY_PATREON_NAME: 'wp_pname_v1',
    KEY_LAST_SCENE: 'wp_last_scene_v1',
    localStorage: { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) },
    pedidos: [], limpiezas: 0, recargas: 0,
    location: { reload() { ctx.recargas++; } },
    window: { addEventListener: (t, f) => { oyentes[t] = f; } },
    fetch: async (url, op) => {
      ctx.pedidos.push({ url, op });
      const r = respuestas.shift() || { status: 500 };
      return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.cuerpo || {} };
    },
  };
  ctx.clearPromptCache = () => { ctx.limpiezas++; };
  ctx.olvidarUltimaEscena = () => m.delete('wp_last_scene_v1');
  ctx._computeAccessTier = () => (m.get('wp_session_id_v1') && ['premium', 'full'].includes(m.get('wp_ptier_v1')) ? m.get('wp_ptier_v1') : 'free');
  vm.createContext(ctx);
  vm.runInContext('var currentAccessTier = _computeAccessTier();\n' + bloqueSesion + '\n' + bloqueAtras, ctx);
  return { ctx, m, oyentes, correr: c => vm.runInContext(c, ctx) };
}
const A = 'a'.repeat(32), B = 'b'.repeat(32);
const ok = (sessionId, tier = 'full') => ({ status: 200, cuerpo: { sessionId, tier, name: 'Sintética' } });
let casos = 0;
const probar = async (nombre, fn) => { await fn(); casos++; console.log('OK ' + nombre); };

await probar('otra cuenta en el mismo navegador no hereda "Continuar mi última escena"', async () => {
  const p = pagina({ local: { wp_session_id_v1: A, wp_last_scene_v1: 'escena-de-a' }, respuestas: [ok(B)] });
  await p.correr('_verifyPatreonSession()');
  assert.equal(p.m.get('wp_session_id_v1'), B);
  assert.equal(p.m.has('wp_last_scene_v1'), false);
  assert.ok(p.ctx.limpiezas >= 1, 'También se vacía la caché de prompts');
});
await probar('la misma cuenta conserva su última escena', async () => {
  const p = pagina({ local: { wp_session_id_v1: A, wp_last_scene_v1: 'escena-de-a' }, respuestas: [ok(A)] });
  await p.correr('_verifyPatreonSession()');
  assert.equal(p.m.get('wp_last_scene_v1'), 'escena-de-a');
});
await probar('una sesión vencida (401) olvida la escena; un anónimo conserva la suya', async () => {
  const vencida = pagina({ local: { wp_session_id_v1: A, wp_ptier_v1: 'full', wp_last_scene_v1: 'escena-de-a' }, respuestas: [{ status: 401 }] });
  assert.equal(await vencida.correr('_verifyPatreonSession()'), null);
  assert.equal(vencida.m.has('wp_last_scene_v1'), false);
  assert.equal(vencida.m.has('wp_session_id_v1'), false);
  const anonimo = pagina({ local: { wp_last_scene_v1: 'escena-propia' }, respuestas: [{ status: 401 }] });
  await anonimo.correr('_verifyPatreonSession()');
  assert.equal(anonimo.m.get('wp_last_scene_v1'), 'escena-propia');
});
await probar('un 5xx de verify no saca de la cuenta ni olvida nada', async () => {
  const p = pagina({ local: { wp_session_id_v1: A, wp_ptier_v1: 'full', wp_last_scene_v1: 'escena-de-a' }, respuestas: [{ status: 503 }] });
  assert.equal(await p.correr('_verifyPatreonSession()'), null);
  assert.equal(p.m.get('wp_session_id_v1'), A);
  assert.equal(p.m.get('wp_ptier_v1'), 'full');
  assert.equal(p.m.get('wp_last_scene_v1'), 'escena-de-a');
});
await probar('volver con Atrás recarga sólo si cambió la sesión, nunca en el enlace público', async () => {
  const publica = pagina({ origen: 'publico' });
  publica.oyentes.pageshow({ persisted: true });
  assert.equal(publica.ctx.recargas, 0, 'En GitHub Pages no hay sesión: Atrás no pierde la escena');
  const misma = pagina({ local: { wp_session_id_v1: A } });
  misma.oyentes.pageshow({ persisted: true });
  assert.equal(misma.ctx.recargas, 0);
  const cerrada = pagina({ local: { wp_session_id_v1: A } });
  cerrada.m.delete('wp_session_id_v1');
  cerrada.oyentes.pageshow({ persisted: true });
  assert.equal(cerrada.ctx.recargas, 1, 'Salir en otra pestaña no deja ver la cuenta desde el historial');
  const otra = pagina({ local: { wp_session_id_v1: A } });
  otra.m.set('wp_session_id_v1', B);
  otra.oyentes.pageshow({ persisted: true });
  assert.equal(otra.ctx.recargas, 1);
});
await probar('un 403 inesperado revalida una vez: reintenta si el plan sigue, recarga si cambió', async () => {
  const sigue = pagina({ local: { wp_session_id_v1: A, wp_ptier_v1: 'full' }, respuestas: [ok(A, 'full')] });
  assert.equal(await sigue.correr('revalidarSesionUnaVez()'), true);
  assert.equal(await sigue.correr('revalidarSesionUnaVez()'), false, 'Una sola vez por visita');
  assert.equal(sigue.ctx.pedidos.length, 1);
  assert.equal(sigue.ctx.recargas, 0);
  const bajo = pagina({ local: { wp_session_id_v1: A, wp_ptier_v1: 'full' }, respuestas: [ok(A, 'free')] });
  assert.equal(await bajo.correr('revalidarSesionUnaVez()'), false);
  assert.equal(bajo.ctx.recargas, 1);
  const publica = pagina({ origen: 'publico', local: { wp_session_id_v1: A } });
  assert.equal(await publica.correr('revalidarSesionUnaVez()'), false);
  assert.equal(publica.ctx.pedidos.length, 0, 'En el enlace público no hay sesión que revalidar');
});
// El reintento está atado a ensurePrompts: se comprueba que el código lo use.
assert.match(html, /r\.status===403 && \/\^needs_\/\.test\(data\.error\|\|''\) && canAccessCat\(cat\) && await revalidarSesionUnaVez\(\)\) \(\{r, data\} = await pedir\(\)\)/);
casos++;
console.log(casos + ' casos de sesión en la página OK');
