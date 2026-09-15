import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';
import { usuarioAdmin } from './_admin.js';

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
export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const admin = await usuarioAdmin(supabase, req);

    // Para el visitante común la respuesta es igual para todos y cambia poco:
    // se puede cachear un rato. Para el admin no, porque incluye borradores.
    res.setHeader(
      'Cache-Control',
      admin ? 'private, no-store' : 'public, max-age=300, stale-while-revalidate=600'
    );

    const desde = typeof req.query.desde === 'string' ? req.query.desde : '';

    let q = supabase
      .from('categories')
      .select('id, tier, sort_order, ready, status, name, sub, updated_at')
      .order('sort_order', { ascending: true });

    if (!admin) q = q.eq('status', 'publicada');

    // Sin fecha se devuelve todo: sirve para reconstruir el catálogo entero.
    if (desde && !Number.isNaN(Date.parse(desde))) {
      q = q.gt('updated_at', new Date(desde).toISOString());
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    // El cliente necesita saber qué variantes existen ANTES de descargar
    // ningún cuerpo: es lo que decide si dibuja las pestañas de Dúo y Trío.
    const ids = (data || []).map((c) => c.id);
    const porCategoria = {};
    // Paginado a mano y ordenado: PostgREST corta en 1000 filas por defecto,
    // y con 199 categorías por 6 variantes son 1188. Sin esto devolvía las
    // primeras 1000 y las ~32 categorías que caían del otro lado del corte
    // quedaban con variants vacío, como si no tuvieran prompts cargados.
    // El order() es parte del arreglo: sin un orden estable el corte cae en
    // categorías distintas en cada pedido.
    const PAGINA = 1000;
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

    const categorias = (data || []).map((c) => ({
      id: c.id,
      tier: c.tier,
      name: c.name,
      sub: c.sub,
      ready: c.ready,
      sortOrder: c.sort_order,
      status: c.status,
      variants: porCategoria[c.id] || [],
    }));

    // Los ids que el admin eliminó para siempre. Van para todos, no sólo para
    // el admin: las 199 originales siguen en el data/catalog.js que bajó cada
    // visitante, y ésta es la única forma de que las saquen de la lista sin
    // esperar a que se reconstruya el archivo estático y se despliegue.
    const { data: lapidas, error: lErr } = await supabase
      .from('deleted_categories')
      .select('id');
    if (lErr) throw new Error(lErr.message);

    return res.status(200).json({
      categorias,
      eliminadas: (lapidas || []).map((r) => r.id),
      esAdmin: !!admin,
    });
  } catch (e) {
    console.error('GET /api/catalog', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
