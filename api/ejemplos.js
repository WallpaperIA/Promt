import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';
import { bearer, resolveTier } from './_sesion.js';

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
 * Las de casual y editorial las ve cualquiera, sin cuenta: son las que
 * venden. Las de hot y xxx exigen sesión y nivel, porque una URL abierta a
 * una imagen explícita se indexa y después no hay forma de recogerla.
 *
 * Por eso el bucket es PRIVADO y acá se firma una URL temporal recién
 * después de comprobar el tier. El permiso no lo decide el navegador.
 */
export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
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
    if (!filas.length) return res.status(200).json({ id, imagenes: [] });

    const { data: firmadas, error: fErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(filas.map((f) => f.ruta), VIGENCIA_SEG);
    if (fErr) throw new Error(fErr.message);

    const imagenes = (firmadas || []).filter((f) => f.signedUrl).map((f) => f.signedUrl);

    // Las de acceso libre se pueden cachear un rato en el navegador; las que
    // dependen del tier, no, para que no queden en un proxy compartido.
    res.setHeader(
      'Cache-Control',
      necesita === 0 ? 'public, max-age=600' : 'private, no-store'
    );
    return res.status(200).json({ id, imagenes });
  } catch (e) {
    console.error('GET /api/ejemplos', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
