/**
 * Quién es quien pide, resuelto del lado del servidor.
 *
 * El cliente manda un token de sesión y nada más: el tier y la marca de
 * administración salen de la base. Si un endpoint nuevo necesita saber el
 * nivel de acceso, importa de acá en vez de rehacerlo — dos copias de esta
 * lógica se desincronizan y una de las dos termina dando de más.
 */

import { tokenDeSesion, hashSesion } from './_cookie.js';
import { campanaConfigurada } from './_patreon.js';

export const FRESCURA_TIER_MS = 6 * 60 * 60 * 1000;

/** El nombre se conserva para los handlers; ya no acepta Bearer ni JSON. */
export function bearer(req) {
  return tokenDeSesion(req);
}

export function tierComprobado(user) {
  if (user?.is_admin === true) return 'full';
  let campaignId;
  try { campaignId = campanaConfigurada(); } catch { return 'free'; }
  const checked = new Date(user?.tier_checked_at).getTime();
  if (user?.patreon_campaign_id !== campaignId || !Number.isFinite(checked) || checked > Date.now() || Date.now() - checked >= FRESCURA_TIER_MS) return 'free';
  return ['premium', 'full'].includes(user?.tier) ? user.tier : 'free';
}

/**
 * @returns {Promise<{tier:'free'|'premium'|'full', token:string|null, admin:boolean, userId:string|null}>}
 *
 * Devuelve 'free' ante cualquier duda: sin token, con token vencido o
 * inexistente. Nunca lee el tier de lo que manda el cliente.
 */
export async function resolveTier(supabase, token) {
  const anonimo = { tier: 'free', token: null, admin: false, userId: null };
  if (!token) return anonimo;
  const { data: session, error } = await supabase
    .from('sessions')
    .select('expires_at, users(id, tier, is_admin, patreon_campaign_id, tier_checked_at)')
    .eq('token', hashSesion(token))
    .single();
  if (error || !session) return anonimo;
  const vencimiento = new Date(session.expires_at).getTime();
  if (!Number.isFinite(vencimiento) || vencimiento <= Date.now()) return anonimo;
  // Las versiones privadas necesitan el dueño resuelto en esta misma consulta:
  // recibirlo del navegador permitiría editar la biblioteca de otra cuenta.
  const userId = session.users?.id ?? null;
  if (userId == null) return anonimo;
  // La marca de administración manda sobre el tier: si algo dejara esa fila
  // en 'free' por error, el dueño no perdería acceso a su propio catálogo.
  if (session.users?.is_admin === true) return { tier: 'full', token, admin: true, userId };
  return { tier: tierComprobado(session.users), token, admin: false, userId };
}
