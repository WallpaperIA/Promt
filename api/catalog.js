import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';
import { usuarioAdmin } from './_admin.js';
import { bearer } from './_sesion.js';
import { GRATIS } from './_access.js';
import { limitar } from './_limite.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Categorías que no están en data/catalog.js.
 *
 * La lista base es un archivo estático: rápido y sin red. Pero una categoría
 * creada desde el panel no estaría ahí hasta rehacer el archivo y desplegar,
 * y la idea es poder publicar desde el navegador.
 *
 * Entonces: el archivo estático es la base, y esto devuelve el delta —lo
 * creado o modificado después de esa compilación—. Lo normal es que devuelva
 * una lista vacía.
 *
 *   GET /api/catalog?desde=<ISO>   el CATALOG_BUILT_AT del archivo estático
 *
 * Un admin recibe además los borradores, para verlos en el panel.
 */

const CAMPOS = 'id, tier, sort_order, ready, status, name, sub, updated_at';
const PAGINA = 1000;

/**
 * Lee de la base las categorías (con los nombres de sus variantes, nunca los
 * cuerpos), las eliminadas para siempre y las que tienen fotos de ejemplo.
 */
async function leerCatalogo({ soloPublicadas, fechaDesde }) {
  const consultaCategorias = (campos) => {
    let q = supabase.from('categories').select(campos).order('sort_order', { ascending: true });
    if (fechaDesde) q = q.gt('updated_at', fechaDesde);
    if (soloPublicadas) q = q.eq('status', 'publicada');
    return q;
  };

  // Las consultas que no dependen unas de otras van juntas. En fila eran
  // seis viajes a Supabase y quien tenía sesión, que no pasa por el CDN,
  // esperaba más de un segundo en cada carga.
  // Las variantes vienen dentro de cada categoría (prompt_bodies tiene la
  // clave foránea a categories): sólo el nombre de la variante, nunca el
  // cuerpo. Hasta el 23/10/2026 se pedían después, en tandas de 1000 y en
  // fila: con 332 escenas y 1785 variantes, quien tenía sesión esperaba
  // 1,1 a 1,5 s, y la página armaba la lista dos veces.
  const [cats, lapidasR, conEjR] = await Promise.all([
    consultaCategorias(CAMPOS + ', prompt_bodies(variant)'),
    // Los ids que el admin eliminó para siempre. Van para todos, no sólo
    // para el admin: las 199 originales siguen en el data/catalog.js que
    // bajó cada visitante, y ésta es la única forma de que las saquen de la
    // lista sin esperar a que se reconstruya el archivo estático.
    supabase.from('deleted_categories').select('id'),
    // Qué categorías tienen imagen de ejemplo. Va la lista de ids y nada
    // más: sin esto el navegador tendría que preguntar de a una por las 199
    // para saber si dibujar la galería.
    supabase.from('category_examples').select('cat_id'),
  ]);
  if (lapidasR.error) throw new Error(lapidasR.error.message);
  if (conEjR.error) throw new Error(conEjR.error.message);
  let filas = cats.data;
  let variantesAparte = false;
  if (cats.error) {
    // Si la base no conoce la relación (o ve más de una), se vuelve al
    // camino anterior en vez de dejar el sitio sin las escenas del delta.
    if (!['PGRST200', 'PGRST201'].includes(cats.error.code)) throw new Error(cats.error.message);
    console.error('GET /api/catalog: variantes en dos pasos,', cats.error.code);
    const sinVariantes = await consultaCategorias(CAMPOS);
    if (sinVariantes.error) throw new Error(sinVariantes.error.message);
    filas = sinVariantes.data;
    variantesAparte = true;
  }
  filas = filas || [];

  // El cliente necesita saber qué variantes existen ANTES de descargar
  // ningún cuerpo: es lo que decide si dibuja las pestañas de Dúo y Trío.
  const porCategoria = {};
  if (!variantesAparte) {
    for (const c of filas) porCategoria[c.id] = (c.prompt_bodies || []).map((v) => v.variant).sort();
  }
  const ids = variantesAparte ? filas.map((c) => c.id) : [];
  // Paginado a mano y ordenado: PostgREST corta en 1000 filas por defecto,
  // y con 199 categorías por 6 variantes son 1188. Sin esto devolvía las
  // primeras 1000 y las ~32 categorías que caían del otro lado del corte
  // quedaban con variants vacío, como si no tuvieran prompts cargados.
  // El order() es parte del arreglo: sin un orden estable el corte cae en
  // categorías distintas en cada pedido.
  for (let desdeFila = 0; ids.length; desdeFila += PAGINA) {
    const { data: vars, error: vErr } = await supabase
      .from('prompt_bodies')
      .select('cat_id, variant')
      .in('cat_id', ids)
      .order('cat_id', { ascending: true })
      .order('variant', { ascending: true })
      .range(desdeFila, desdeFila + PAGINA - 1);
    if (vErr) throw new Error(vErr.message);
    for (const v of vars || []) {
      (porCategoria[v.cat_id] ||= []).push(v.variant);
    }
    if (!vars || vars.length < PAGINA) break;
  }

  return {
    categorias: filas.map((c) => ({
      id: c.id,
      tier: c.tier,
      name: c.name,
      sub: c.sub,
      ready: c.ready,
      sortOrder: c.sort_order,
      status: c.status,
      variants: porCategoria[c.id] || [],
      // Sólo para filtrar por `desde` la copia en memoria; no se responde.
      actualizada: Date.parse(c.updated_at),
    })),
    eliminadas: (lapidasR.data || []).map((r) => r.id),
    conEjemplos: [...new Set((conEjR.data || []).map((r) => r.cat_id))],
  };
}

/**
 * Lo publicado, guardado en la memoria de cada instancia. Sin admin la
 * respuesta es igual para todos salvo `desde`, que se filtra acá. Antes cada
 * pedido con cuenta=1 o actualizar=1 (que saltan el CDN), o con un desde
 * distinto, hacía tres consultas a Supabase con todas las escenas: un
 * dispositivo que lo repitiera en bucle gastaba la base. Ahora es una
 * lectura cada 30 s por instancia, lleguen los pedidos que lleguen. Un
 * cambio del panel tarda hasta eso en verse sin admin (el enlace público ya
 * esperaba hasta 5 minutos al CDN). Si Supabase falla, se sigue entregando
 * la última copia buena durante 10 minutos, como hace el CDN.
 */
const CACHE_PUBLICO_MS = 30 * 1000;
const RESPALDO_PUBLICO_MS = 10 * 60 * 1000;
let publico = null;
let preparandoPublico = null;

async function leerPublico() {
  const ahora = Date.now();
  if (publico && ahora >= publico.creado && ahora - publico.creado < CACHE_PUBLICO_MS) return publico.datos;
  // Los pedidos simultáneos esperan la misma lectura; un error no queda
  // guardado ni bloquea el próximo intento.
  if (!preparandoPublico) {
    preparandoPublico = (async () => {
      const creado = Date.now();
      try {
        const datos = await leerCatalogo({ soloPublicadas: true, fechaDesde: '' });
        publico = { datos, creado };
        return datos;
      } catch (e) {
        if (publico && Date.now() - publico.creado < RESPALDO_PUBLICO_MS) {
          console.error('GET /api/catalog: se entrega la copia anterior,', e.message);
          return publico.datos;
        }
        throw e;
      }
    })().finally(() => { preparandoPublico = null; });
  }
  return preparandoPublico;
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  // Hasta tener una respuesta buena nada se cachea: un error o un 405
  // guardados en el CDN se servirían a todos durante minutos.
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (limitar(req, res, 'catalogo', 60)) return;

  // Con token la respuesta es de esa cuenta (el admin recibe borradores y
  // esAdmin): nunca va a una caché compartida. Se decide por la presencia
  // del token y no por quién resulta ser, así ningún camino lo olvida.
  // La cuenta usa otra clave de URL y nunca permite caché, incluso antes de
  // recibir su marca local. Cookie no tiene el bypass especial de Authorization.
  const conSesion = req.query.cuenta === '1' || !!bearer(req);
  // La actualización explícita y la vuelta de una pestaña móvil deben leer
  // el catálogo actual, también desde el enlace público de GitHub Pages.
  const actualizar = req.query.actualizar === '1';
  if(actualizar) res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

  try {
    const desde = typeof req.query.desde === 'string' ? req.query.desde : '';
    // Sin fecha se devuelve todo: sirve para reconstruir el catálogo entero.
    const fechaDesde = desde && !Number.isNaN(Date.parse(desde)) ? new Date(desde).toISOString() : '';

    // Sólo una cookie puede ser de un admin. El admin lee siempre de la base
    // (ve sus borradores y lo que acaba de cambiar); todos los demás reciben
    // lo publicado de la copia en memoria. La copia se pide mientras se
    // comprueba la cuenta, no después: casi siempre es lo que se responde.
    const publicoPedido = leerPublico();
    publicoPedido.catch(() => {}); // si responde el admin, su fallo no importa
    const admin = bearer(req) ? await usuarioAdmin(supabase, req) : null;
    let datos;
    if (admin) {
      datos = await leerCatalogo({ soloPublicadas: false, fechaDesde });
    } else {
      const base = await publicoPedido;
      const limite = fechaDesde ? Date.parse(fechaDesde) : null;
      datos = { ...base, categorias: limite == null ? base.categorias : base.categorias.filter((c) => c.actualizada > limite) };
    }

    if (conSesion || actualizar) {
      res.setHeader('Cache-Control', 'private, no-store');
    } else {
      // Sin cuenta la respuesta es igual para todos. El navegador la guarda
      // un minuto; el CDN de Vercel cinco, y pasado ese tiempo sigue
      // entregando la anterior mientras pide la nueva en segundo plano, así
      // ningún visitante espera a Supabase. Si Supabase falla, sirve la última
      // buena durante un día. Vercel no usa su caché cuando el pedido trae
      // Authorization, y por eso tampoco puede devolverle esto a una sesión.
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.setHeader('Vercel-CDN-Cache-Control', 'max-age=300, stale-while-revalidate=86400, stale-if-error=86400');
    }

    return res.status(200).json({
      categorias: datos.categorias.map(({ actualizada, ...c }) => c),
      eliminadas: datos.eliminadas,
      conEjemplos: datos.conEjemplos,
      // Las que el plan gratis puede abrir. El navegador las usa sólo para
      // dibujar candados; quien decide es canAccess() en /api/prompt.
      gratis: GRATIS,
      esAdmin: !!admin,
    });
  } catch (e) {
    console.error('GET /api/catalog', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
