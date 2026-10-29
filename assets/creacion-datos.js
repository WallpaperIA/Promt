// Sólo preferencias privadas; no contiene prompts, credenciales ni permisos.
export const CLAVES_CREACION = ['wp_combinations_v1', 'wp_collections_v1', 'wp_random_locks_v1', 'wp_news_v1'];
export const CANDADOS_INICIALES = Object.freeze({ characters: true, outfit: false, hair: false, details: false, style: false, format: true });
export const VERSION_NOVEDADES = '2026-10-29-creacion';
const objeto = x => !!x && typeof x === 'object' && !Array.isArray(x);
const texto = (x, max = 100) => typeof x === 'string' && x.length <= max;
const lista = (x, max = 50) => Array.isArray(x) && x.length <= max && x.every(v => texto(v));
const campos = (x, claves) => objeto(x) && Object.keys(x).every(k => claves.includes(k));
const id = x => texto(x, 64) && /^[a-z0-9-]+$/i.test(x);
const mapa = (x, max, validar) => objeto(x) && Object.keys(x).length <= max && Object.entries(x).every(([k, v]) => id(k) && validar(v));
export const cantidadPersonas = modo => ({ solo: 1, duo: 2, trio: 3 })[modo] || 1;
export function validarCombinacion(c) {
  if (!campos(c, ['name', 'catId', 'mode', 'style', 'outfit', 'hair', 'format', 'details', 'people', 'characters'])) return false;
  if (!texto(c.name, 80) || !c.name.trim() || !texto(c.catId, 150) || !['solo', 'duo', 'trio'].includes(c.mode)) return false;
  if (!['style', 'outfit', 'hair', 'format'].every(k => texto(c[k]))) return false;
  if (!lista(c.details) || !Array.isArray(c.people) || c.people.length !== cantidadPersonas(c.mode)) return false;
  if (!Array.isArray(c.characters) || c.characters.length !== cantidadPersonas(c.mode) || !c.characters.every(x => texto(x, 200))) return false;
  return c.people.every(p => campos(p, ['outfit', 'hair', 'details']) &&
    (p.outfit === undefined || texto(p.outfit)) && (p.hair === undefined || texto(p.hair)) &&
    (p.details === undefined || lista(p.details)));
}
export function validarDatoCreacion(clave, x) {
  if (clave === 'wp_combinations_v1') return mapa(x, 80, validarCombinacion);
  if (clave === 'wp_random_locks_v1') return campos(x, Object.keys(CANDADOS_INICIALES)) && Object.values(x).every(v => typeof v === 'boolean');
  if (clave === 'wp_collections_v1') return campos(x, ['folders', 'versions']) &&
    mapa(x.folders, 40, f => campos(f, ['name']) && texto(f.name, 80) && !!f.name.trim()) && mapa(x.versions, 200, v => v === '' || id(v));
  if (clave === 'wp_news_v1') return campos(x, ['release', 'scenes']) && texto(x.release) &&
    objeto(x.scenes) && Object.keys(x.scenes).length <= 2000 && Object.entries(x.scenes).every(([k, v]) => texto(k, 150) && v === true);
  return false;
}
const copiar = x => JSON.parse(JSON.stringify(x));
export function crearAlmacenCreacion(storage, avisar = () => {}) {
  function leer(clave, inicial) {
    try { const x = JSON.parse(storage.getItem(clave)); return validarDatoCreacion(clave, x) ? x : copiar(inicial); }
    catch { return copiar(inicial); }
  }
  function guardar(clave, dato) {
    if (!validarDatoCreacion(clave, dato)) return false;
    try { storage.setItem(clave, JSON.stringify(dato)); avisar(clave); return true; } catch { return false; }
  }
  return { leer, guardar };
}
/** Sólo IDs que existen y opciones del plan actual. El servidor sigue autorizando los cuerpos. */
export function normalizarCombinacion(c, catalogos, permite = () => true) {
  const s = copiar(c), omitidos = [];
  function opcion(tipo, valor, base) {
    const v = catalogos[tipo].find(x => x.id === valor);
    if (v && permite(v.tier || 'free')) return valor;
    omitidos.push(valor); return base;
  }
  s.style = opcion('styles', s.style, 'playboy');
  s.outfit = opcion('outfits', s.outfit, 'none');
  s.hair = opcion('hairs', s.hair, 'none');
  s.format = opcion('formats', s.format, '16-9');
  s.details = s.details.filter(x => catalogos.details.some(d => d.id === x && permite(d.tier || 'free')));
  s.people = s.people.map(p => ({
    ...(p.outfit !== undefined ? { outfit: opcion('outfits', p.outfit, 'none') } : {}),
    ...(p.hair !== undefined ? { hair: opcion('hairs', p.hair, 'none') } : {}),
    ...(p.details !== undefined ? { details: p.details.filter(x => catalogos.details.some(d => d.id === x && catalogos.personal(x) && permite(d.tier || 'free'))) } : {}),
  }));
  return { estado: s, omitidos };
}
function elegir(lista, anterior, azar, usados = []) {
  const libres = lista.filter(x => !usados.includes(x));
  let opciones = libres.filter(x => x !== anterior);
  if (!opciones.length) opciones = libres;
  if (!opciones.length) opciones = lista.filter(x => x !== anterior);
  if (!opciones.length) opciones = lista;
  return opciones.length ? opciones[Math.min(opciones.length - 1, Math.floor(azar() * opciones.length))] : anterior;
}
function sortearDetalles(lista, azar) {
  const grupos = new Map();
  for (const d of lista) { const g = d.excl || d.group; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(d.id); }
  const elegidos = [];
  for (const opciones of grupos.values()) if (azar() < 0.38 && elegidos.length < 3) elegidos.push(elegir(opciones, '', azar));
  return elegidos;
}
export function sorprender(actual, candados, catalogos, permite = () => true, personajes = [], azar = Math.random) {
  const s = copiar(actual), locks = { ...CANDADOS_INICIALES, ...candados };
  const opciones = k => catalogos[k].filter(x => permite(x.tier || 'free')).map(x => x.id);
  if (!locks.style) s.style = elegir(opciones('styles'), s.style, azar);
  if (!locks.format) s.format = elegir(opciones('formats'), s.format, azar);
  const n = cantidadPersonas(s.mode);
  if (!locks.characters) {
    const nombres = [...new Set(personajes.filter(x => texto(x, 200) && x.trim()))];
    if (nombres.length >= n) { const usados = []; s.characters = s.characters.map(v => { const x = elegir(nombres, v, azar, usados); usados.push(x); return x; }); }
  }
  for (const [campo, tipo] of [['outfit', 'outfits'], ['hair', 'hairs']]) {
    if (locks[campo]) continue;
    const usados = [];
    if (s.mode === 'solo') s[campo] = elegir(opciones(tipo), s[campo], azar);
    else s.people.forEach(p => { const x = elegir(opciones(tipo), p[campo] ?? s[campo], azar, usados); p[campo] = x; usados.push(x); });
  }
  if (!locks.details) {
    const disponibles = catalogos.details.filter(d => permite(d.tier || 'free'));
    s.details = sortearDetalles(disponibles.filter(d => s.mode === 'solo' || !catalogos.personal(d.id)), azar);
    if (s.mode !== 'solo') s.people.forEach(p => { p.details = sortearDetalles(disponibles.filter(d => catalogos.personal(d.id)), azar); });
  }
  return s;
}
export function resolverPersonas(s, personal) {
  return s.people.map((p, i) => ({ name: s.characters[i] || 'Persona ' + (i + 1),
    outfit: p.outfit ?? s.outfit, hair: p.hair ?? s.hair,
    details: p.details === undefined ? s.details.filter(personal) : p.details,
  }));
}
export function versionesColeccion(lista, colecciones, filtro) {
  if (!filtro) return lista;
  return lista.filter(v => {
    const carpeta = colecciones.versions[v.id];
    return filtro === 'unfiled' ? !colecciones.folders[carpeta] : carpeta === filtro;
  });
}
export function escenasNuevas(catalogo, vistas) { return catalogo.filter(c => c.ready !== false && !vistas[c.id]); }
