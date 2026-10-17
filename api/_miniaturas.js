/**
 * Miniaturas de las fotos de ejemplo.
 *
 * Las tarjetas de Explorar y las fotos chicas de la portada usaban la foto
 * grande (~145 KB cada una): bajar seis pantallas en el celular eran más
 * de 3 MB. La miniatura es la misma foto a 640 px de ancho en WebP, ~27 KB.
 *
 * La genera el navegador del admin al subir (o con el botón Miniaturas del
 * panel para las que ya estaban) y vive junto a la original en el mismo
 * bucket privado. El nombre se deriva de la ruta de la original, así no hace
 * falta una columna nueva ni una migración: si no existe, se usa la grande.
 */

/** Ancho al que el panel reduce la foto. */
export const MINI_ANCHO = 640;

/** Tope de una miniatura. A 640 px las del catálogo pesan 15-70 KB. */
export const MINI_MAX_BYTES = 200 * 1024;

export function rutaMiniatura(ruta) {
  return ruta + '.mini.webp';
}

/** RIFF....WEBP: lo único que se acepta como miniatura. */
export function esWebp(bytes) {
  return bytes.length > 12
    && bytes.toString('latin1', 0, 4) === 'RIFF'
    && bytes.toString('latin1', 8, 12) === 'WEBP';
}

/**
 * Lee una miniatura enviada como data URL o base64. Devuelve los bytes, o
 * un código de error para responder 400/413.
 */
export function leerMiniatura(texto) {
  const b64 = String(texto || '').split(',').pop() || '';
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length) return { error: 'miniatura_vacia' };
  if (bytes.length > MINI_MAX_BYTES) return { error: 'miniatura_grande' };
  if (!esWebp(bytes)) return { error: 'miniatura_no_webp' };
  return { bytes };
}
