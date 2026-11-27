import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';
import { exigirAdmin } from '../_admin.js';
import { leerMiniatura, rutaMiniatura, coincideConTipo } from '../_miniaturas.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const BUCKET = 'ejemplos';
/** Vercel corta el cuerpo cerca de 4,5 MB; con base64 el archivo crece ~33%. */
const MAX_BYTES = 3 * 1024 * 1024;
const TIPOS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
/** PostgREST y el listado de Storage cortan en 1000: se leen por páginas. */
const PAGINA = 1000;
/**
 * Desde este peso, la revisión automática del panel baja la original para
 * ver si conviene achicarla (lo decide versionLiviana() en la página: más de
 * 1920 px o 600 KB y un ahorro de al menos 15 %). Las de ~1024 px pesan ~90
 * KB y las ya achicadas ~200-350 KB, así que no se vuelven a bajar.
 */
const REVISAR_DESDE_BYTES = 400 * 1024;
/** Carpetas (una por escena) que se listan en Storage a la vez. */
const LISTADOS_A_LA_VEZ = 12;

/**
 * La fila de esa categoría con esa ruta, o null. Es la autoridad antes de
 * escribir o borrar en Storage: la ruta que manda el cliente sólo vale si
 * pertenece a un ejemplo de la categoría (sin esto, una ruta inventada o de
 * otra categoría alcanzaba para pisar o borrar un archivo ajeno).
 */
async function filaDeCategoria(catId, ruta) {
  const { data, error } = await supabase
    .from('category_examples')
    .select('ruta')
    .eq('cat_id', catId)
    .eq('ruta', ruta)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function leerTodosLosEjemplos() {
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase
      .from('category_examples')
      .select('cat_id, ruta')
      .order('cat_id', { ascending: true })
      .order('ruta', { ascending: true })
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data || []));
    if (!data || data.length < PAGINA) return filas;
  }
}

const carpetaDe = (ruta) => ruta.slice(0, Math.max(0, ruta.lastIndexOf('/')));

/** El peso de cada archivo de una carpeta del bucket, por ruta completa. */
async function pesosDeCarpeta(carpeta) {
  const pesos = new Map();
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase.storage.from(BUCKET).list(carpeta, { limit: PAGINA, offset: desde });
    if (error) throw new Error(`listando: ${error.message}`);
    for (const archivo of data || []) {
      // Las subcarpetas vienen sin metadata.
      if (typeof archivo?.metadata?.size === 'number') pesos.set((carpeta ? carpeta + '/' : '') + archivo.name, archivo.metadata.size);
    }
    if (!data || data.length < PAGINA) return pesos;
  }
}

/**
 * Las fotos que la revisión automática del panel tiene que mirar: las que
 * pesan más de REVISAR_DESDE_BYTES (`pesada`, para achicar) o no tienen
 * miniatura, con la URL de su original. El peso sale de Storage, así la
 * página no baja todas para medirlas (son ~90 MB). Hasta el 27/11/2026 esto
 * lo hacían a mano los botones Miniaturas y Optimizar fotos, con un pedido
 * por escena.
 */
async function fotosParaRevisar() {
  const filas = await leerTodosLosEjemplos();
  const carpetas = [...new Set(filas.map((f) => carpetaDe(f.ruta)))];
  const pesos = new Map();
  for (let i = 0; i < carpetas.length; i += LISTADOS_A_LA_VEZ) {
    for (const deCarpeta of await Promise.all(carpetas.slice(i, i + LISTADOS_A_LA_VEZ).map(pesosDeCarpeta))) {
      for (const [ruta, bytes] of deCarpeta) pesos.set(ruta, bytes);
    }
  }
  // Una fila sin archivo no tiene nada que revisar: la galería ya la saltea.
  const pendientes = filas
    .filter((f) => pesos.has(f.ruta))
    .map((f) => ({ id: f.cat_id, ruta: f.ruta, bytes: pesos.get(f.ruta), mini: pesos.has(rutaMiniatura(f.ruta)) }))
    .map((f) => ({ ...f, pesada: f.bytes > REVISAR_DESDE_BYTES }))
    .filter((f) => f.pesada || !f.mini);
  const fotos = [];
  for (let i = 0; i < pendientes.length; i += 200) {
    const tanda = pendientes.slice(i, i + 200);
    // Media hora: la revisión las baja de a una y puede tardar.
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(tanda.map((f) => f.ruta), 1800);
    if (error) throw new Error(error.message);
    tanda.forEach((f, j) => { if (data?.[j]?.signedUrl) fotos.push({ ...f, url: data[j].signedUrl }); });
  }
  return { total: filas.length, fotos };
}

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
 *   GET    ?todas=1                  las fotos de todas las escenas que la
 *                                    revisión automática tiene que mirar
 *   POST   { id, archivo, tipo, miniatura? }
 *                                    sube una (archivo en base64); la
 *                                    miniatura WebP la genera el panel
 *   PUT    { id, ruta, miniatura }   agrega o rehace la miniatura de una
 *                                    que ya estaba (revisión automática)
 *   PUT    { id, ruta, accion: 'principal' }
 *                                    elige la portada sin borrar ejemplos
 *   PUT    { id, ruta, accion: 'optimizar', archivo }
 *                                    reemplaza la original por la versión
 *                                    liviana que arma el panel (revisión
 *                                    automática), en la misma ruta
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
      if (req.query.todas === '1') return res.status(200).json(await fotosParaRevisar());
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
      // grande hasta que la rehaga la revisión automática del panel.
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
      const { id, ruta, miniatura, accion, archivo } = req.body || {};
      const catId = String(id || '').trim();
      const rutaOriginal = String(ruta || '').trim();
      if (!catId || !rutaOriginal) return res.status(400).json({ error: 'faltan_parametros' });
      if (accion === 'principal') {
        const { data: imagenes, error: listaErr } = await supabase
          .from('category_examples')
          .select('ruta, orden')
          .eq('cat_id', catId)
          .order('orden', { ascending: true });
        if (listaErr) throw listaErr;
        if (!imagenes?.some(im => im.ruta === rutaOriginal)) {
          return res.status(400).json({ error: 'ruta_ajena' });
        }
        // Una sola actualización deja la elegida delante del resto. Se
        // conservan las fotos y su orden relativo para poder volver atrás.
        if (imagenes[0].ruta !== rutaOriginal) {
          const primero = imagenes[0].orden;
          if (!Number.isInteger(primero) || primero <= -2147483648) {
            return res.status(409).json({ error: 'orden_no_disponible' });
          }
          const { error: principalErr } = await supabase
            .from('category_examples')
            .update({ orden: primero - 1 })
            .eq('cat_id', catId)
            .eq('ruta', rutaOriginal);
          if (principalErr) throw principalErr;
        }
        return res.status(200).json({ ok: true, principal: rutaOriginal });
      }
      if (accion === 'optimizar') {
        // Las originales que salen del generador a 2752 px pesaban hasta
        // 1,3 MB y la galería las baja enteras. El panel arma una versión de
        // 1920 px como máximo y la guarda en la misma ruta: la fila, el orden
        // y la miniatura siguen sirviendo. El tipo sale de la extensión de la
        // ruta guardada, no del pedido: el archivo nunca cambia de formato
        // bajo su nombre.
        const tipo = Object.keys(TIPOS).find(t => rutaOriginal.endsWith('.' + TIPOS[t]));
        if (!tipo) return res.status(400).json({ error: 'tipo_no_permitido' });
        const bytes = Buffer.from(String(archivo || '').split(',').pop() || '', 'base64');
        if (!bytes.length) return res.status(400).json({ error: 'archivo_vacio' });
        if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'demasiado_grande', maximo: MAX_BYTES });
        if (!coincideConTipo(bytes, tipo)) return res.status(400).json({ error: 'archivo_no_es_imagen' });
        const ejemplo = await filaDeCategoria(catId, rutaOriginal);
        if (!ejemplo) return res.status(400).json({ error: 'ruta_ajena' });
        const { error: subErr } = await supabase.storage
          .from(BUCKET)
          .upload(ejemplo.ruta, bytes, { contentType: tipo, upsert: true });
        if (subErr) throw new Error(`optimizando: ${subErr.message}`);
        return res.status(200).json({ ok: true, bytes: bytes.length });
      }
      if (accion) return res.status(400).json({ error: 'accion_no_permitida' });
      const mini = leerMiniatura(miniatura);
      if (mini.error) return res.status(400).json({ error: mini.error });
      // El nombre sale de una fila de esta categoría, nunca del pedido: sin
      // esto se podría escribir en cualquier ruta del bucket.
      const ejemplo = await filaDeCategoria(catId, rutaOriginal);
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
      if (!await filaDeCategoria(id, ruta)) return res.status(400).json({ error: 'ruta_ajena' });

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
