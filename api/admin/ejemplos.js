import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';
import { exigirAdmin } from '../_admin.js';
import { leerMiniatura, rutaMiniatura, coincideConTipo } from '../_miniaturas.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const BUCKET = 'ejemplos';
/** Vercel corta el cuerpo cerca de 4,5 MB; con base64 el archivo crece ~33%. */
const MAX_BYTES = 3 * 1024 * 1024;
const TIPOS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

function carpetaEjemplos(id) {
  // Storage rechaza tildes en las rutas. Codificar los bytes conserva el ID
  // de la categoría y evita juntar «mañana» y «manana» en la misma carpeta.
  return /^[a-z0-9_-]+$/i.test(id) ? id : 'utf8/' + Buffer.from(id, 'utf8').toString('hex');
}

/**
 * Imágenes de ejemplo, del lado del admin.
 *
 *   GET    ?id=<cat>[&firmar=1]      lista las rutas cargadas; con firmar,
 *                                    también la URL de cada original y si ya
 *                                    tiene miniatura
 *   POST   { id, archivo, tipo, miniatura? }
 *                                    sube una (archivo en base64); la
 *                                    miniatura WebP la genera el panel
 *   PUT    { id, ruta, miniatura }   agrega o rehace la miniatura de una
 *                                    que ya estaba (botón Miniaturas)
 *   DELETE ?id=<cat>&ruta=<ruta>     borra una, con su miniatura
 *
 * El archivo va en base64 dentro del JSON en vez de multipart: no hace falta
 * un parser extra y el tamaño que se acepta es chico igual. Si en algún
 * momento hay que subir originales grandes, conviene pasar a una URL de
 * subida firmada y que el navegador escriba directo en Storage.
 */
export default async function handler(req, res) {
  applyCors(req, res, 'GET, POST, PUT, DELETE, OPTIONS');
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
      const imagenes = data || [];
      if (req.query.firmar !== '1' || !imagenes.length) return res.status(200).json({ imagenes });
      // Para generar miniaturas el panel necesita leer la original. Una firma
      // corta alcanza: se usa enseguida y sólo la recibe el admin.
      const rutas = imagenes.map((im) => im.ruta);
      const { data: firmadas, error: fErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls([...rutas, ...rutas.map(rutaMiniatura)], 600);
      if (fErr) throw new Error(fErr.message);
      return res.status(200).json({
        imagenes: imagenes.map((im, i) => ({
          ...im,
          url: firmadas?.[i]?.signedUrl || null,
          mini: !!firmadas?.[rutas.length + i]?.signedUrl,
        })),
      });
    }

    if (req.method === 'POST') {
      const { id, archivo, tipo, miniatura } = req.body || {};
      const catId = String(id || '').trim();
      if (!catId) return res.status(400).json({ error: 'falta_id' });
      if (!TIPOS[tipo]) return res.status(400).json({ error: 'tipo_no_permitido' });
      // La miniatura es opcional (un navegador sin WebP no la manda), pero
      // si viene mal se rechaza antes de subir nada.
      const mini = miniatura ? leerMiniatura(miniatura) : null;
      if (mini?.error) return res.status(400).json({ error: mini.error });

      const { data: cat } = await supabase.from('categories').select('id').eq('id', catId).single();
      if (!cat) return res.status(404).json({ error: 'no_encontrada' });

      // Llega como data URL del navegador; se queda con lo que va después de la coma.
      const b64 = String(archivo || '').split(',').pop() || '';
      const bytes = Buffer.from(b64, 'base64');
      if (!bytes.length) return res.status(400).json({ error: 'archivo_vacio' });
      if (bytes.length > MAX_BYTES) {
        return res.status(413).json({ error: 'demasiado_grande', maximo: MAX_BYTES });
      }
      if (!coincideConTipo(bytes, tipo)) return res.status(400).json({ error: 'archivo_no_es_imagen' });

      // El nombre lo pone el servidor: si viniera del cliente, un ../ escribiría
      // fuera de la carpeta de la categoría.
      const ruta = `${carpetaEjemplos(catId)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${TIPOS[tipo]}`;

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

      // Si la miniatura falla, la foto ya quedó bien: la tarjeta usa la
      // grande hasta que el botón Miniaturas la rehaga.
      let conMiniatura = false;
      if (mini) {
        const { error: miniErr } = await supabase.storage
          .from(BUCKET)
          .upload(rutaMiniatura(ruta), mini.bytes, { contentType: 'image/webp', upsert: true });
        if (miniErr) console.error('admin/ejemplos miniatura', miniErr.message);
        conMiniatura = !miniErr;
      }

      return res.status(201).json({ ok: true, ruta, miniatura: conMiniatura });
    }

    if (req.method === 'PUT') {
      const { id, ruta, miniatura } = req.body || {};
      const catId = String(id || '').trim();
      const rutaOriginal = String(ruta || '').trim();
      if (!catId || !rutaOriginal) return res.status(400).json({ error: 'faltan_parametros' });
      const mini = leerMiniatura(miniatura);
      if (mini.error) return res.status(400).json({ error: mini.error });
      // El nombre sale de una fila de esta categoría, nunca del pedido: sin
      // esto se podría escribir en cualquier ruta del bucket.
      const { data: ejemplo, error: consultaErr } = await supabase
        .from('category_examples')
        .select('ruta')
        .eq('cat_id', catId)
        .eq('ruta', rutaOriginal)
        .maybeSingle();
      if (consultaErr) throw new Error(consultaErr.message);
      if (!ejemplo) return res.status(400).json({ error: 'ruta_ajena' });
      const { error: subErr } = await supabase.storage
        .from(BUCKET)
        .upload(rutaMiniatura(ejemplo.ruta), mini.bytes, { contentType: 'image/webp', upsert: true });
      if (subErr) throw new Error(`miniatura: ${subErr.message}`);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
      const ruta = typeof req.query.ruta === 'string' ? req.query.ruta.trim() : '';
      if (!id || !ruta) return res.status(400).json({ error: 'faltan_parametros' });
      // La ruta tiene que pertenecer a esa categoría: sin esto, un id cualquiera
      // más una ruta ajena borraría el ejemplo de otra.
      if (!ruta.startsWith(carpetaEjemplos(id) + '/') && !ruta.startsWith(id + '/')) {
        return res.status(400).json({ error: 'ruta_ajena' });
      }
      // El prefijo «utf8» puede coincidir con otro ID. La fila vinculada a
      // la categoría es la autoridad antes de borrar un archivo de Storage.
      const { data: ejemplo, error: consultaErr } = await supabase
        .from('category_examples')
        .select('ruta')
        .eq('cat_id', id)
        .eq('ruta', ruta)
        .maybeSingle();
      if (consultaErr) throw new Error(consultaErr.message);
      if (!ejemplo) return res.status(400).json({ error: 'ruta_ajena' });

      await supabase.storage.from(BUCKET).remove([ruta, rutaMiniatura(ruta)]);
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
