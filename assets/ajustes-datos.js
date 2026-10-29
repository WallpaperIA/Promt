// Datos de preferencias compartidos por la API y el navegador. Nunca credenciales.
import { CLAVES_CREACION, validarDatoCreacion } from './creacion-datos.js';
export const CLAVES_AJUSTES = Object.freeze([
  'wp_chars_v1', 'wp_deleted_v2', 'wp_favs_v1', 'wp_edits_v1', 'wp_stats_v1',
  'wp_compact_v1', 'wp_sort_v1', 'wp_style_v1', 'wp_outfit_v1', 'wp_outfit_favs_v1',
  'wp_hair_v1', 'wp_format_v1', 'wp_details_v1', 'wp_accent_v1', 'wp_vip_theme_v1',
  'wp_lp_collapsed_v1', 'wp_people_v1', 'wp_last_scene_v1', 'wp_open_scene_v1',
  ...CLAVES_CREACION,
]);
export const MAX_AJUSTES_BYTES = 600000;
const LISTAS = new Set(['wp_deleted_v2', 'wp_favs_v1', 'wp_outfit_favs_v1', 'wp_details_v1']);
const MAPAS = new Set(['wp_edits_v1', 'wp_stats_v1', 'wp_people_v1', ...CLAVES_CREACION]);
const propio = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const objeto = o => !!o && typeof o === 'object' && !Array.isArray(o);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const peligroso = k => ['__proto__', 'prototype', 'constructor'].includes(k);
function seguro(v, nivel = 0) {
  if (nivel > 8) return false;
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
  if (typeof v === 'string') return v.length <= 30000;
  if (Array.isArray(v)) return v.length <= 2000 && v.every(x => seguro(x, nivel + 1));
  return objeto(v) && Object.keys(v).length <= 2000 && Object.entries(v).every(([k, x]) =>
    !peligroso(k) && k.length <= 200 && seguro(x, nivel + 1));
}
export function validarAjustes(datos) {
  if (!objeto(datos) || Object.keys(datos).length > CLAVES_AJUSTES.length) return false;
  if (new TextEncoder().encode(JSON.stringify(datos)).length > MAX_AJUSTES_BYTES) return false;
  return Object.entries(datos).every(([k, v]) => {
    if (!CLAVES_AJUSTES.includes(k)) return false;
    if (v === null) return true; // una eliminación explícita
    if (typeof v !== 'string' || v.length > 500000) return false;
    if (LISTAS.has(k) || MAPAS.has(k) || k === 'wp_chars_v1') {
      let p; try { p = JSON.parse(v); } catch { return false; }
      if (!seguro(p)) return false;
      if (CLAVES_CREACION.includes(k)) return validarDatoCreacion(k, p);
      if (LISTAS.has(k)) return Array.isArray(p) && p.every(x => typeof x === 'string' && x.length <= 100);
      if (k === 'wp_chars_v1') return Array.isArray(p) && p.length <= 500 && p.every(x =>
        objeto(x) && typeof x.name === 'string' && x.name.trim().length > 0 && x.name.length <= 200);
      return objeto(p);
    }
    return v.length <= 150;
  });
}
export function cambiosAjustes(base, actual) {
  const cambios = {};
  for (const k of CLAVES_AJUSTES) if ((base[k] ?? null) !== (actual[k] ?? null)) cambios[k] = actual[k] ?? null;
  return cambios;
}
function unirMapa(base, local, remoto, conflictos, ruta) {
  const r = { ...remoto };
  for (const k of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (peligroso(k) || igual(base[k], local[k])) continue;
    if (igual(base[k], remoto[k]) || igual(local[k], remoto[k])) {
      if (propio(local, k)) r[k] = local[k]; else delete r[k];
    } else if (objeto(base[k]) && objeto(local[k]) && objeto(remoto[k])) {
      r[k] = unirMapa(base[k], local[k], remoto[k], conflictos, ruta + '.' + k);
    } else if ([base[k], local[k], remoto[k]].every(Array.isArray) && ruta.startsWith('wp_people_v1')) {
      if ([...base[k], ...local[k], ...remoto[k]].every(x => typeof x === 'string')) {
        const borrados = new Set(base[k].filter(x => !local[k].includes(x)));
        r[k] = [...new Set([...remoto[k].filter(x => !borrados.has(x)), ...local[k].filter(x => !base[k].includes(x))])];
      } else {
        const mapa = xs => Object.fromEntries(xs.map((x, i) => [String(i), x]));
        r[k] = Object.values(unirMapa(mapa(base[k]), mapa(local[k]), mapa(remoto[k]), conflictos, ruta + '.' + k));
      }
    } else if (ruta === 'wp_stats_v1' && [base[k], local[k], remoto[k]].every(x => typeof x === 'number') && local[k] >= base[k]) {
      r[k] = remoto[k] + local[k] - base[k];
    } else conflictos.push(ruta + '.' + k); // conservar remoto y guardar respaldo local
  }
  return r;
}
/** Tres vías: cambios locales desde base sobre la última copia de cuenta. */
export function combinarAjustes(base = {}, local = {}, remoto = {}) {
  const datos = { ...remoto }, conflictos = [];
  for (const [k, v] of Object.entries(cambiosAjustes(base, local))) {
    const anterior = base[k] ?? null, nube = remoto[k] ?? null;
    if (anterior === nube || v === nube) {
      if (v === null) delete datos[k]; else datos[k] = v;
      continue;
    }
    try {
      const b = anterior === null ? (MAPAS.has(k) ? {} : []) : JSON.parse(anterior);
      const l = v === null ? (MAPAS.has(k) ? {} : []) : JSON.parse(v);
      const r = nube === null ? (MAPAS.has(k) ? {} : []) : JSON.parse(nube);
      if (LISTAS.has(k) && [b, l, r].every(Array.isArray)) {
        const borrados = new Set(b.filter(x => !l.includes(x)));
        datos[k] = JSON.stringify([...new Set([...r.filter(x => !borrados.has(x)), ...l.filter(x => !b.includes(x))])]);
      } else if (k === 'wp_chars_v1' && [b, l, r].every(Array.isArray)) {
        const mapa = xs => Object.fromEntries(xs.filter(x => x?.name && !peligroso(x.name)).map(x => [x.name, x]));
        datos[k] = JSON.stringify(Object.values(unirMapa(mapa(b), mapa(l), mapa(r), conflictos, k)));
      } else if (MAPAS.has(k) && [b, l, r].every(objeto)) {
        datos[k] = JSON.stringify(unirMapa(b, l, r, conflictos, k));
      } else conflictos.push(k);
    } catch { conflictos.push(k); }
  }
  return { datos, conflictos };
}
