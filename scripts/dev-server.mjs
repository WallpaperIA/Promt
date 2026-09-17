#!/usr/bin/env node
/**
 * Servidor de desarrollo: sirve el sitio estático y simula /api/prompt
 * leyendo build/prompts.seed.json, usando la MISMA lógica de acceso que
 * produccción (api/_access.js). Permite probar el gating sin Supabase.
 *
 * Uso:
 *   node scripts/dev-server.mjs [--tier free|premium|full] [--port 8100]
 *
 * El cupo free se lleva en memoria y se reinicia al reiniciar el proceso.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { FREE_WEEKLY_LIMIT, currentWeek, buildRotation, canAccess } from '../api/_access.js';
import { validarCategoria } from '../api/_validar.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const TIER = arg('--tier', 'free');
const ES_ADMIN = process.argv.includes('--admin');
const PORT = Number(arg('--port', 8100));

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'prompts.seed.json'), 'utf8'));
const bodies = new Map();
for (const r of seed) {
  if (!bodies.has(r.cat_id)) bodies.set(r.cat_id, {});
  bodies.get(r.cat_id)[r.variant] = r.body;
}

const sandbox = {};
vm.createContext(sandbox);
new vm.Script(
  fs.readFileSync(path.join(ROOT, 'data', 'catalog.js'), 'utf8') + ';globalThis.__out={CATEGORIES};'
).runInContext(sandbox);
const categories = sandbox.__out.CATEGORIES.map((c) => ({ id: c.id, tier: c.tier, ready: c.ready }));

const used = new Set();
/** Ids eliminados para siempre desde la papelera. Simula deleted_categories. */
const eliminadas = new Set();
/**
 * Ejemplos por categoría: id → [urls]. Se cargan con --ejemplos <id>[,<id>]
 * y apuntan a una imagen de relleno, para poder ver la galería sin Supabase.
 */
const ejemplos = new Map();
for (const id of (arg('--ejemplos', '') || '').split(',').filter(Boolean)) {
  // Servidas por este mismo servidor, no por un sitio externo: así la galería
  // se puede probar sin salida a internet.
  ejemplos.set(id, ['/__ejemplo/1.svg', '/__ejemplo/2.svg']);
}
/** Categorías creadas desde el panel, en memoria. Se pierden al reiniciar. */
const borradores = new Map();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  const json = (code, obj) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(code).end(JSON.stringify(obj));
  };

  const leerJson = () => new Promise((resolve) => {
    const p = [];
    req.on('data', (c) => p.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(p).toString() || '{}')); } catch { resolve({}); } });
  });

  // ── /api/catalog simulado ──
  if (url.pathname === '/api/catalog') {
    if (req.method === 'OPTIONS') return json(200, {});
    const desde = url.searchParams.get('desde') || '';
    const extras = [...borradores.values()]
      .filter((c) => ES_ADMIN || c.status === 'publicada')
      .filter((c) => !desde || new Date(c.updated_at) > new Date(desde))
      .map((c) => ({
        id: c.id, tier: c.tier, name: c.name, sub: c.sub, ready: c.ready,
        sortOrder: c.sort_order, status: c.status,
        variants: Object.keys(c.prompts || {}),
      }));
    return json(200, { categorias: extras, eliminadas: [...eliminadas], conEjemplos: [...ejemplos.keys()], esAdmin: ES_ADMIN });
  }

  // ── /api/admin/ejemplos simulado ──
  if (url.pathname === '/api/admin/ejemplos') {
    if (req.method === 'OPTIONS') return json(200, {});
    if (!ES_ADMIN) return json(401, { error: 'no_autorizado' });
    const idQ = url.searchParams.get('id') || '';

    if (req.method === 'GET') {
      const l = ejemplos.get(idQ) || [];
      return json(200, { imagenes: l.map((u, i) => ({ ruta: idQ + '/' + (i + 1) + '.svg', orden: i })) });
    }
    if (req.method === 'POST') {
      const c = await leerJson();
      const id = String(c.id || '').trim();
      if (!id) return json(400, { error: 'falta_id' });
      if (!['image/webp', 'image/jpeg', 'image/png'].includes(c.tipo)) {
        return json(400, { error: 'tipo_no_permitido' });
      }
      // Se guarda la data URL tal cual: alcanza para verla en el navegador.
      const l = ejemplos.get(id) || [];
      l.push(c.archivo);
      ejemplos.set(id, l);
      return json(201, { ok: true, ruta: id + '/' + l.length + '.svg' });
    }
    if (req.method === 'DELETE') {
      const ruta = url.searchParams.get('ruta') || '';
      if (!ruta.startsWith(idQ + '/')) return json(400, { error: 'ruta_ajena' });
      const i = Number(ruta.split('/').pop().split('.')[0]) - 1;
      const l = ejemplos.get(idQ) || [];
      if (i >= 0 && i < l.length) l.splice(i, 1);
      if (!l.length) ejemplos.delete(idQ); else ejemplos.set(idQ, l);
      return json(200, { ok: true });
    }
    return json(405, { error: 'metodo_no_permitido' });
  }

  // ── /api/admin/categories simulado ──
  if (url.pathname === '/api/admin/categories') {
    if (req.method === 'OPTIONS') return json(200, {});
    if (!ES_ADMIN) return json(401, { error: 'no_autorizado' });

    const idQ = url.searchParams.get('id') || '';
    const accion = url.searchParams.get('accion') || '';

    if (req.method === 'GET') {
      if (idQ) {
        const c = borradores.get(idQ);
        return c ? json(200, { categoria: c }) : json(404, { error: 'no_encontrada' });
      }
      const fijas = categories.map((c) => ({
        id: c.id, tier: c.tier, name: c.id, sub: '', status: 'publicada',
        tested_at: null, ready: c.ready,
      }));
      return json(200, { categorias: [...borradores.values(), ...fijas] });
    }

    const cuerpo = await leerJson();

    if (req.method === 'POST' && accion) {
      const c = borradores.get(cuerpo.id);
      if (!c) return json(404, { error: 'no_encontrada' });
      if (accion === 'probar') {
        const v = validarCategoria(c);
        if (!v.ok) return json(400, { error: 'no_pasa_verificaciones', ...v });
        c.status = 'prueba'; c.tested_at = new Date().toISOString(); c.tested_note = cuerpo.nota || null;
        return json(200, { ok: true, status: 'prueba' });
      }
      if (accion === 'publicar') {
        const v = validarCategoria(c);
        if (!v.ok) return json(400, { error: 'no_pasa_verificaciones', ...v });
        if (!c.tested_at) return json(400, { error: 'sin_prueba_manual' });
        c.status = 'publicada'; c.ready = true;
        return json(200, { ok: true, status: 'publicada' });
      }
      if (accion === 'despublicar') { c.status = 'borrador'; return json(200, { ok: true }); }
      return json(400, { error: 'accion_desconocida' });
    }

    if (req.method === 'POST') {
      const id = String(cuerpo.id || '').trim();
      const existentes = [...borradores.keys(), ...categories.map((c) => c.id)];
      if (!id || existentes.includes(id)) return json(400, { error: 'id_invalido_o_repetido' });
      borradores.set(id, {
        id, tier: cuerpo.tier || 'casual', name: cuerpo.name || '', sub: cuerpo.sub || '',
        prompts: cuerpo.prompts || {}, status: 'borrador', ready: false,
        sort_order: 900 + borradores.size, tested_at: null,
        updated_at: new Date().toISOString(),
      });
      return json(201, { ok: true, id, validacion: validarCategoria(cuerpo, existentes) });
    }

    if (req.method === 'PUT') {
      const c = borradores.get(cuerpo.id);
      if (!c) return json(404, { error: 'no_encontrada' });
      const teniaPrueba = !!c.tested_at;
      Object.assign(c, {
        tier: cuerpo.tier ?? c.tier, name: cuerpo.name ?? c.name, sub: cuerpo.sub ?? c.sub,
        updated_at: new Date().toISOString(),
      });
      if (cuerpo.prompts) { c.prompts = cuerpo.prompts; c.tested_at = null; if (c.status === 'prueba') c.status = 'borrador'; }
      return json(200, { ok: true, validacion: validarCategoria(c), pruebaInvalidada: teniaPrueba && !c.tested_at });
    }

    if (req.method === 'DELETE') {
      // ?definitivo=1 borra para siempre, esté publicada o no, y deja lápida.
      // Vale también para las del catálogo estático, que es el caso que la
      // papelera tiene que cubrir.
      const definitivo = url.searchParams.get('definitivo') === '1';
      const c = borradores.get(idQ);
      const fija = categories.find((x) => x.id === idQ);
      if (!c && !fija) return json(404, { error: 'no_encontrada' });
      if (!definitivo) {
        if (!c) return json(400, { error: 'despublicar_primero' });
        if (c.status === 'publicada') return json(400, { error: 'despublicar_primero' });
        borradores.delete(idQ);
        return json(200, { ok: true });
      }
      eliminadas.add(idQ);
      borradores.delete(idQ);
      const i = categories.findIndex((x) => x.id === idQ);
      if (i >= 0) categories.splice(i, 1);
      return json(200, { ok: true, eliminada: idQ });
    }

    return json(405, { error: 'metodo_no_permitido' });
  }

  // Imagen de relleno para probar la galería, generada acá.
  if (url.pathname.startsWith('/__ejemplo/')) {
    const n = url.pathname.match(/(\d+)/)?.[1] || '1';
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 506">` +
      `<rect width="900" height="506" fill="#141418"/>` +
      `<text x="450" y="265" font-family="sans-serif" font-size="46" fill="#DA7F20" text-anchor="middle">Ejemplo ${n}</text></svg>`
    );
  }

  // ── /api/ejemplos simulado ──
  if (url.pathname === '/api/ejemplos') {
    if (req.method === 'OPTIONS') return json(200, {});
    const id = url.searchParams.get('id') || '';
    const cat = categories.find((c) => c.id === id) || borradores.get(id);
    if (!cat) return json(404, { error: 'not_found' });
    const libres = ['casual', 'editorial'].includes(cat.tier);
    const puede = libres || ES_ADMIN || ['premium', 'full'].includes(TIER);
    const imgs = ejemplos.get(id) || [];
    if (!puede) return json(403, { error: 'needs_upgrade', tier: TIER, hay: imgs.length });
    return json(200, { id, imagenes: imgs });
  }

  if (url.pathname === '/api/prompt') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') return res.writeHead(200).end();

    const id = url.searchParams.get('id') || '';

    // Los borradores del panel también se sirven, igual que en producción, donde
    // /api/prompt se los da al admin y devuelve 404 a todos los demás. Sin esto
    // el simulador cortaba antes de construir el cuerpo, y un bug que sólo ve
    // el admin —el único que recibe categorías con ready:false— no aparecía acá.
    const borrador = borradores.get(id);
    if (borrador) {
      if (!ES_ADMIN) return res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
      return res.writeHead(200).end(JSON.stringify({ id, tier: TIER, prompts: borrador.prompts || {} }));
    }

    const cat = categories.find((c) => c.id === id);
    if (!cat) return res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));

    const week = currentWeek();
    const verdict = canAccess(cat, TIER, buildRotation(categories, week));
    if (!verdict.ok) return res.writeHead(403).end(JSON.stringify({ error: verdict.reason, tier: TIER }));

    if (verdict.countsAgainstQuota) {
      if (!used.has(id) && used.size >= FREE_WEEKLY_LIMIT) {
        return res.writeHead(429).end(
          JSON.stringify({ error: 'quota_exceeded', tier: TIER, used: used.size, limit: FREE_WEEKLY_LIMIT })
        );
      }
      used.add(id);
    }

    const payload = { id, tier: TIER, prompts: bodies.get(id) || {} };
    if (verdict.countsAgainstQuota) { payload.used = used.size; payload.limit = FREE_WEEKLY_LIMIT; }
    console.log(`  200 ${id} (tier=${TIER}${verdict.countsAgainstQuota ? `, cupo ${used.size}/${FREE_WEEKLY_LIMIT}` : ''})`);
    return res.writeHead(200).end(JSON.stringify(payload));
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return res.writeHead(404).end('not found');
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  // El cliente apunta a Vercel; para probar en local se reescribe la base.
  // Cualquier .html, no sólo index: los archivos de prueba también necesitan
  // que API_BASE apunte a este servidor.
  if (rel.endsWith('.html')) {
    // En producción API_BASE es '' si la página se sirve desde *.vercel.app.
    // En local el host es localhost, así que se fuerza esa rama para que los
    // pedidos vayan a este mismo servidor.
    let html = fs
      .readFileSync(file, 'utf8')
      .replace("location.hostname.endsWith('.vercel.app')", 'true');

    // Hook sólo de desarrollo: ?__autoopen=<cat-id> abre esa sección sola,
    // para poder sacar capturas headless. No existe en producción.
    const autoOpen = url.searchParams.get('__autoopen');
    if (autoOpen) {
      html = html.replace(
        '</body>',
        `<style>#lp-section{display:none!important}</style>
        <script>
          // Los errores se vuelcan al DOM para poder leerlos en --dump-dom.
          window.__errs = [];
          addEventListener('error', e => { window.__errs.push('ERROR: ' + (e.message||e.error)); dumpErrs(); });
          addEventListener('unhandledrejection', e => { window.__errs.push('REJECT: ' + (e.reason && (e.reason.stack||e.reason.message) || e.reason)); dumpErrs(); });
          function dumpErrs(){
            let d = document.getElementById('__errbox');
            if (!d) { d = document.createElement('pre'); d.id='__errbox'; document.body.appendChild(d); }
            d.textContent = window.__errs.join('\\n---\\n');
          }
          addEventListener('load', () => setTimeout(() => {
            const id = "${autoOpen.replace(/"/g, '')}";
            const w = document.querySelector('.sec-wrap[data-id="' + id + '"]');
            if (!w) return;
            // Filtrar por nombre deja la categoría arriba de todo, así la
            // captura headless la toma sin depender del scroll suave.
            const s = document.getElementById('search');
            s.value = w.dataset.name;
            s.dispatchEvent(new Event('input', {bubbles:true}));
            setTimeout(() => {
              const sec = w.querySelector('.section');
              // El init abre la primera sección sola; sólo hay que clickear
              // si la que buscamos todavía está cerrada.
              if (!sec.classList.contains('open')) w.querySelector('.sec-info').click();
            }, 150);
          }, 400));
        </script></body>`
      );
    }
    return res.end(html);
  }
  res.end(fs.readFileSync(file));
});

server.listen(PORT, () => {
  console.log(`\nWallpaperia dev · http://localhost:${PORT}`);
  console.log(`tier simulado: ${TIER}   (cambiar con --tier premium|full)`);
  console.log(`admin: ${ES_ADMIN ? 'sí' : 'no'}   (activar con --admin)\n`);
});
