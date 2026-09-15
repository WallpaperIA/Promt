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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const TIER = arg('--tier', 'free');
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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/prompt') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') return res.writeHead(200).end();

    const id = url.searchParams.get('id') || '';
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
  console.log(`tier simulado: ${TIER}   (cambiar con --tier premium|full)\n`);
});
