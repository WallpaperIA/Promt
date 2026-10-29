import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';
import { revalidarTier } from '../_patreon.js';
import { bearer, tierComprobado, FRESCURA_TIER_MS } from '../_sesion.js';
import { hashSesion, exigirOrigenSesion, borrarCookieSesion } from '../_cookie.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Cada cuánto se relee el tier contra Patreon.
 *
 * El webhook cubre el caso instantáneo, pero puede fallar o no estar
 * configurado, así que esto es la red de seguridad. Seis horas mantiene el
 * dato fresco sin castigar la carga de página: sólo la primera visita
 * después de ese lapso paga el viaje a Patreon.
 */
const FRESCURA_MS = FRESCURA_TIER_MS;

export default async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!exigirOrigenSesion(req, res)) return;

  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Invalid session' });

  const { data: session, error } = await supabase
    .from('sessions')
    .select('expires_at, users(id, patreon_id, tier, is_admin, full_name, patreon_campaign_id, tier_checked_at, patreon_access_token, patreon_refresh_token, patreon_token_expires_at)')
    .eq('token', hashSesion(token))
    .single();

  // Sin filas (PGRST116) la cookie ya no vale y se borra. Otro error es una
  // falla de la base: borrarla ahí obligaba a repetir el OAuth, que además
  // cierra las sesiones de los otros dispositivos.
  if (error && error.code !== 'PGRST116') return res.status(503).json({ error: 'session_unavailable' });
  if (!session) { borrarCookieSesion(res); return res.status(401).json({ error: 'Invalid session' }); }
  // Una fecha inválida no compara como menor: antes dejaba pasar una sesión
  // que el resto de la API rechazaba. El vencimiento debe ser válido y futuro.
  const vencimiento = new Date(session.expires_at).getTime();
  if (!Number.isFinite(vencimiento) || vencimiento <= Date.now()) return res.status(401).json({ error: 'Session expired' });

  const user = session.users;
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  let tier = tierComprobado(user);
  let name = user.full_name;

  // Si el tier está viejo, se relee contra Patreon antes de responder.
  // Las cuentas de administración quedan afuera: su acceso no depende de
  // tener una suscripción activa a la propia campaña.
  const revisado = user.tier_checked_at ? new Date(user.tier_checked_at).getTime() : 0;
  if (!user.is_admin && (tier !== user.tier || !Number.isFinite(revisado) || Date.now() - revisado >= FRESCURA_MS)) {
    try {
      const { tier: nuevo, updates } = await revalidarTier(user);
      const { error: updateErr } = await supabase.from('users').update(updates).eq('id', user.id);
      if (updateErr) throw updateErr;
      tier = tierComprobado({ ...user, ...updates, tier: nuevo });
      if (updates.full_name) name = updates.full_name;
    } catch (e) {
      // "No se pudo consultar" no es "dejó de pagar": si Patreon dice que no
      // es miembro, revalidarTier devuelve free y se guarda arriba. Acá
      // falló la consulta (5xx, 429, red, token), así que vale lo último
      // comprobado, y tierComprobado() lo acota a VALIDEZ_TIER_MS. Un plan
      // sin campaña registrada no se conserva: sería el acceso que corregimos.
      // tier_checked_at no se toca: se reintenta en la próxima carga.
      console.error('revalidación de tier falló:', e.code || 'membership_check_failed');
      // Sólo los campos del token (camposDeToken), nunca el tier.
      if (e.tokensRenovados) {
        const { error: tokenErr } = await supabase.from('users').update(e.tokensRenovados).eq('id', user.id);
        if (tokenErr) console.error('no se guardaron los tokens renovados:', tokenErr.code || 'db_error');
      }
    }
  }

  // Sólo lo que el frontend usa. El email es PII que no hace falta exponer.
  // La UI de administración no debe depender de que el catálogo público
  // haya salido de caché antes o después de verificar esta sesión.
  // Es una marca pública de cambio de sesión, no una credencial reutilizable.
  res.status(200).json({ tier, name, esAdmin: user.is_admin === true, accountId: user.id, sessionId: hashSesion(token).slice(0, 32) });
}
