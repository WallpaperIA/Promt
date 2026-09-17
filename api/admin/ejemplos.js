import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';
import { exigirAdmin } from '../_admin.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const BUCKET = 'ejemplos';
/** Vercel corta el cuerpo cerca de 4,5 MB; con base64 el archivo crece ~33%. */
const MAX_BYTES = 3 * 1024 * 1024;
const TIPOS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

/**
 * Imágenes de ejemplo, del lado del admin.
 *
 *   GET    ?id=<cat>                 lista las rutas cargadas
 *   POST   { id, archivo, tipo }     sube una (archivo en base64)
 *   DELETE ?id=<cat>&ruta=<ruta>     borra una
 *
 * El archivo va en base64 dentro del JSON en vez de multipart: no hace falta
 * un parser extra y el tamaño que se acepta es chico igual. Si en algún
 * momento hay que subir originales grandes, conviene pasar a una URL de
 * subida firmada y que el navegador escriba directo en Storage.
 */
export default async function handler(req, res) {
  applyCors(req, res, 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await exigirAdmin(supabase, req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
      if (!id) return res.status(400).json({ error: 'falta_id' });
      const { data, error } = await supabase
        .from('category_examples')
        .select('ruta, orden')
        .eq('cat_id', id)
        .order('orden', { ascending: true });
      if (error) throw new Error(error.message);
      return res.status(200).json({ imagenes: data || [] });
    }

    if (req.method === 'POST') {
      const { id, archivo, tipo } = req.body || {};
      const catId = String(id || '').trim();
      if (!catId) return res.status(400).json({ error: 'falta_id' });
      if (!TIPOS[tipo]) return res.status(400).json({ error: 'tipo_no_permitido' });

      const { data: cat } = await supabase.from('categories').select('id').eq('id', catId).single();
      if (!cat) return res.status(404).json({ error: 'no_encontrada' });

      // Llega como data URL del navegador; se queda con lo que va después de la coma.
      const b64 = String(archivo || '').split(',').pop() || '';
      const bytes = Buffer.from(b64, 'base64');
      if (!bytes.length) return res.status(400).json({ error: 'archivo_vacio' });
      if (bytes.length > MAX_BYTES) {
        return res.status(413).json({ error: 'demasiado_grande', maximo: MAX_BYTES });
      }

      // El nombre lo pone el servidor: si viniera del cliente, un ../ escribiría
      // fuera de la carpeta de la categoría.
      const ruta = `${catId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${TIPOS[tipo]}`;

      const { error: subErr } = await supabase.storage
        .from(BUCKET)
        .upload(ruta, bytes, { contentType: tipo, upsert: false });
      if (subErr) throw new Error(`subiendo: ${subErr.message}`);

      const { count } = await supabase
        .from('category_examples')
        .select('ruta', { count: 'exact', head: true })
        .eq('cat_id', catId);

      const { error: insErr } = await supabase
        .from('category_examples')
        .insert({ cat_id: catId, ruta, orden: count || 0 });
      if (insErr) {
        // Si no se pudo anotar, el archivo subido quedaría huérfano ocupando
        // espacio y sin que nadie lo vea nunca.
        await supabase.storage.from(BUCKET).remove([ruta]);
        throw new Error(`registrando: ${insErr.message}`);
      }

      return res.status(201).json({ ok: true, ruta });
    }

    if (req.method === 'DELETE') {
      const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
      const ruta = typeof req.query.ruta === 'string' ? req.query.ruta.trim() : '';
      if (!id || !ruta) return res.status(400).json({ error: 'faltan_parametros' });
      // La ruta tiene que pertenecer a esa categoría: sin esto, un id cualquiera
      // más una ruta ajena borraría el ejemplo de otra.
      if (!ruta.startsWith(id + '/')) return res.status(400).json({ error: 'ruta_ajena' });

      await supabase.storage.from(BUCKET).remove([ruta]);
      const { error } = await supabase
        .from('category_examples')
        .delete()
        .eq('cat_id', id)
        .eq('ruta', ruta);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'metodo_no_permitido' });
  } catch (e) {
    console.error('admin/ejemplos', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
