import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';
import { revalidarTier } from '../_patreon.js';

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
const FRESCURA_MS = 6 * 60 * 60 * 1000;

export default async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'No token' });

  const { data: session, error } = await supabase
    .from('sessions')
    .select('expires_at, users(id, tier, is_admin, full_name, tier_checked_at, patreon_access_token, patreon_refresh_token, patreon_token_expires_at)')
    .eq('token', token)
    .single();

  if (error || !session) return res.status(401).json({ error: 'Invalid session' });
  if (new Date(session.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired' });

  const user = session.users;
  let tier = user.is_admin ? 'full' : user.tier;
  let name = user.full_name;

  // Si el tier está viejo, se relee contra Patreon antes de responder.
  // Las cuentas de administración quedan afuera: su acceso no depende de
  // tener una suscripción activa a la propia campaña.
  const revisado = user.tier_checked_at ? new Date(user.tier_checked_at).getTime() : 0;
  if (!user.is_admin && Date.now() - revisado > FRESCURA_MS) {
    try {
      const { tier: nuevo, updates } = await revalidarTier(user);
      await supabase.from('users').update(updates).eq('id', user.id);
      tier = nuevo;
      if (updates.full_name) name = updates.full_name;
    } catch (e) {
      // Si Patreon no responde se sigue con el último tier conocido: mejor
      // que dejar afuera a alguien que paga por una caída ajena.
      // Tampoco se toca tier_checked_at, así que se reintenta en la próxima.
      console.error('revalidación de tier falló:', e.message);
    }
  }

  // Sólo lo que el frontend usa. El email es PII que no hace falta exponer.
  res.status(200).json({ tier, name });
}
