import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';
import { bearer, resolveTier } from './_sesion.js';
import { rutaMiniatura } from './_miniaturas.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const BUCKET = 'ejemplos';
/** Minutos que vive la URL firmada. Corta, pero alcanza para ver la página. */
const VIGENCIA_SEG = 60 * 30;

/** Rango de acceso: un tier alcanza para ver los ejemplos de los de abajo. */
const RANGO = { casual: 0, editorial: 0, hot: 1, xxx: 2 };
const RANGO_USUARIO = { free: 0, premium: 1, full: 2 };

/** La misma regla para una escena y para el lote: una sola copia. */
function nivelNecesario(cat) {
  return RANGO[cat.tier] ?? 2;
}
function puedeVerFotos(cat, sesion) {
  const tiene = sesion.admin ? 2 : (RANGO_USUARIO[sesion.tier] ?? 0);
  return tiene >= nivelNecesario(cat);
}

const ANONIMO = { tier: 'free', admin: false };
/** PostgREST corta en 1000 filas: las listas completas se leen por páginas. */
const PAGINA = 1000;
/** Rutas por pedido de firma, para no armar un cuerpo enorme. */
const FIRMAS_POR_PEDIDO = 200;

async function leerTodo(consulta) {
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await consulta().range(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data || []));
    if (!data || data.length < PAGINA) return filas;
  }
}

async function firmar(rutas) {
  const tandas = [];
  for (let i = 0; i < rutas.length; i += FIRMAS_POR_PEDIDO) tandas.push(rutas.slice(i, i + FIRMAS_POR_PEDIDO));
  const respuestas = await Promise.all(tandas.map((tanda) =>
    supabase.storage.from(BUCKET).createSignedUrls(tanda, VIGENCIA_SEG)));
  return respuestas.flatMap(({ data, error }, i) => {
    if (error) throw new Error(error.message);
    return tandas[i].map((_, j) => data?.[j]?.signedUrl || null);
  });
}

/**
 * GET /api/ejemplos?todas=1 — la primera foto de cada escena que quien pide
 * puede ver, en un solo pedido: la usan las tarjetas de Explorar, las filas
 * de Lista y la portada. La galería sigue pidiendo todas las de una escena.
 *
 * Hasta el 22/10/2026 la página hacía un pedido por escena, de a cuatro y
 * de 0,5 a 1 s cada uno: con Full eran más de 300 para recorrer Explorar.
 *
 * Sin sesión la respuesta es igual para todos y la guarda el CDN. Las firmas
 * siguen durando 30 minutos y Storage repite una misma firma durante varios
 * minutos, así que el CDN la guarda poco: lo que sirve tiene que seguir
 * valiendo mientras la página lo usa.
 */
async function todas(req, res) {
  // La URL de la cuenta lleva cuenta=1: la caché de Vercel no separa por
  // cookie, y una respuesta con fotos Hot o Íntimas no puede ir a otro.
  const privada = req.query.cuenta === '1' || !!bearer(req);
  const sesion = privada ? await resolveTier(supabase, bearer(req)) : ANONIMO;

  const [categorias, ejemplos] = await Promise.all([
    leerTodo(() => {
      let q = supabase.from('categories').select('id, tier, status').order('id', { ascending: true });
      if (!sesion.admin) q = q.eq('status', 'publicada');
      return q;
    }),
    leerTodo(() => supabase.from('category_examples').select('cat_id, ruta, orden')
      .order('cat_id', { ascending: true }).order('orden', { ascending: true }).order('ruta', { ascending: true })),
  ]);
  const permitidas = new Set(categorias
    .filter((c) => (c.status === 'publicada' || sesion.admin) && puedeVerFotos(c, sesion))
    .map((c) => c.id));

  const primeras = new Map();
  for (const e of ejemplos) {
    if (permitidas.has(e.cat_id) && !primeras.has(e.cat_id)) primeras.set(e.cat_id, e.ruta);
  }
  const ids = [...primeras.keys()], rutas = [...primeras.values()];
  const firmadas = rutas.length ? await firmar([...rutas, ...rutas.map(rutaMiniatura)]) : [];

  const fotos = {};
  ids.forEach((id, i) => {
    const imagen = firmadas[i];
    if (imagen) fotos[id] = { imagen, miniatura: firmadas[rutas.length + i] || imagen };
  });

  if (privada) {
    res.setHeader('Cache-Control', 'private, no-store');
  } else {
    // Peor caso: la firma ya tenía ~15 min al recibirla, el CDN la sirve 6
    // min más, el navegador 1 y la página la usa 5. Queda margen ante los 30.
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Vercel-CDN-Cache-Control', 'max-age=240, stale-while-revalidate=120');
  }
  return res.status(200).json({ fotos });
}

/**
 * Imágenes de ejemplo de una categoría.
 *
 *   GET /api/ejemplos?id=<categoria>
 *
 * Devuelve `imagenes` (las originales, para la galería) y `miniaturas`, en
 * el mismo orden: la versión liviana de cada una, o la original si todavía
 * no tiene. Van en la misma respuesta para que portada, tarjetas y galería
 * sigan compartiendo un solo pedido por escena.
 *
 * Las de casual y editorial las ve cualquiera, sin cuenta: son las que
 * venden. Las de hot e íntimo exigen sesión y nivel: sus fotos no deben
 * quedar accesibles sin comprobar la cuenta.
 *
 * Por eso el bucket es PRIVADO y acá se firma una URL temporal recién
 * después de comprobar el tier. El permiso no lo decide el navegador.
 */
export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  // Los rechazos, errores y galerías vacías también pueden depender de la
  // sesión. Sólo una respuesta pública comprobada permite usar caché.
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (req.query.todas === '1') {
    try {
      return await todas(req, res);
    } catch (e) {
      console.error('GET /api/ejemplos?todas=1', e);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(500).json({ error: 'server_error' });
    }
  }

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id || id.length > 100) return res.status(400).json({ error: 'bad_request' });

  try {
    const { data: cat } = await supabase
      .from('categories')
      .select('tier, status')
      .eq('id', id)
      .single();
    if (!cat) return res.status(404).json({ error: 'not_found' });

    const sesion = await resolveTier(supabase, bearer(req));
    const { tier, admin } = sesion;

    if (cat.status !== 'publicada' && !admin) return res.status(404).json({ error: 'not_found' });

    const necesita = nivelNecesario(cat);
    if (!puedeVerFotos(cat, sesion)) {
      // Se dice que hay ejemplo pero no se manda: sirve para invitar a
      // suscribirse sin exponer la imagen.
      const { count } = await supabase
        .from('category_examples')
        .select('ruta', { count: 'exact', head: true })
        .eq('cat_id', id);
      return res.status(403).json({ error: 'needs_upgrade', tier, hay: count || 0 });
    }

    const { data: filas, error } = await supabase
      .from('category_examples')
      .select('ruta')
      .eq('cat_id', id)
      .order('orden', { ascending: true })
      // Desempate igual al del lote: la primera de la galería es la misma
      // foto que muestra la tarjeta.
      .order('ruta', { ascending: true });
    if (error) throw new Error(error.message);
    const cache = cat.status === 'publicada' && necesita === 0
      ? 'public, max-age=600' : 'private, no-store';
    if (!filas.length) {
      res.setHeader('Cache-Control', cache);
      return res.status(200).json({ id, imagenes: [], miniaturas: [] });
    }

    // Originales y miniaturas en una sola firma. Storage contesta cada ruta
    // por separado: la miniatura que no existe vuelve sin URL y no hace
    // fallar a las demás.
    const rutas = filas.map((f) => f.ruta);
    const { data: firmadas, error: fErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls([...rutas, ...rutas.map(rutaMiniatura)], VIGENCIA_SEG);
    if (fErr) throw new Error(fErr.message);

    const imagenes = [], miniaturas = [];
    rutas.forEach((_, i) => {
      const original = firmadas?.[i]?.signedUrl;
      if (!original) return;
      imagenes.push(original);
      miniaturas.push(firmadas?.[rutas.length + i]?.signedUrl || original);
    });

    // Un borrador Casual/Editorial también es privado: sólo lo ve el admin.
    res.setHeader('Cache-Control', cache);
    return res.status(200).json({ id, imagenes, miniaturas });
  } catch (e) {
    console.error('GET /api/ejemplos', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
