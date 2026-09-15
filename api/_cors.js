/**
 * Orígenes permitidos para llamar a la API.
 *
 * Cuando la app se sirve desde Vercel usa URL relativa (mismo origen), así que
 * CORS no interviene. Esto es sólo para GitHub Pages y, por las dudas, para los
 * previews del propio proyecto.
 *
 * Se devuelve el origen concreto y no '*' porque la API responde distinto según
 * el usuario: con '*' cualquier página podría leer las respuestas.
 */
const ALLOWED_ORIGINS = [
  'https://wallpaperia.github.io',
  'https://promt-iota.vercel.app',
];

// Previews de Vercel de ESTE proyecto y esta cuenta. El sufijo de la cuenta
// importa: con sólo `promt-*.vercel.app` alcanzaría con que alguien creara un
// proyecto llamado "promt-loquesea" para entrar en la lista.
const PREVIEW_RE = /^https:\/\/promt-[a-z0-9]+-iaventassc-5344\.vercel\.app$/;

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin) || PREVIEW_RE.test(origin);
}

/**
 * @param {string} methods p.ej. 'GET, OPTIONS'
 */
export function applyCors(req, res, methods) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  // Sin esto, una caché intermedia podría servirle a un origen la respuesta
  // que se generó para otro.
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
