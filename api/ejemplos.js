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

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id || id.length > 100) return res.status(400).json({ error: 'bad_request' });

  try {
    const { data: cat } = await supabase
      .from('categories')
      .select('tier, status')
      .eq('id', id)
      .single();
    if (!cat) return res.status(404).json({ error: 'not_found' });

    const { tier, admin } = await resolveTier(supabase, bearer(req));

    if (cat.status !== 'publicada' && !admin) return res.status(404).json({ error: 'not_found' });

    const necesita = RANGO[cat.tier] ?? 2;
    const tiene = admin ? 2 : (RANGO_USUARIO[tier] ?? 0);
    if (tiene < necesita) {
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
      .order('orden', { ascending: true });
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
