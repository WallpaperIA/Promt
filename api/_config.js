/**
 * Direcciones fijas del despliegue, en un solo lugar.
 *
 * Antes estaban repetidas en login.js y callback.js apuntando a la URL de un
 * deploy puntual (promt-iiu6ooofm-…). Esa URL tiene Deployment Protection
 * activa, así que exige iniciar sesión en Vercel: el login de Patreon terminaba
 * en una pantalla de error para cualquier visitante.
 *
 * Tiene que ser el dominio de producción, no la URL de un deploy: esas cambian
 * con cada despliegue y están protegidas.
 */

/** Dominio estable de la API. */
export const API_ORIGIN = 'https://promt-iota.vercel.app';

/**
 * Dirección de retorno del OAuth de Patreon.
 * Si esto cambia, hay que registrarlo también en el panel de Patreon
 * (Developers → tu cliente → Redirect URIs), porque Patreon rechaza cualquier
 * redirect_uri que no tenga registrado de antemano.
 */
export const REDIRECT_URI = `${API_ORIGIN}/api/auth/callback`;

/** Dónde vuelve el usuario una vez resuelto el login. */
export const APP_URL = 'https://wallpaperia.github.io/Promt/';
