import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { tierDesdeCentavos } from '../_patreon.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Webhook de Patreon: actualiza el tier en el momento en que alguien se
 * suscribe, cambia de plan o cancela.
 *
 * Sin esto el cambio recién se notaba cuando la persona volvía a entrar, o
 * en la revalidación de verify.js. Con esto es inmediato.
 *
 * Configuración en Patreon → Developers → Webhooks:
 *   URL:     https://promt-iota.vercel.app/api/webhooks/patreon
 *   Eventos: members:pledge:create, members:pledge:update,
 *            members:pledge:delete, members:update, members:delete
 *   El secreto que muestra Patreon va en PATREON_WEBHOOK_SECRET.
 */

// Vercel entrega el cuerpo ya parseado; acá hace falta crudo para la firma.
export const config = { api: { bodyParser: false } };

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

/**
 * Patreon firma con HMAC-MD5 del cuerpo crudo usando el secreto del webhook.
 * La comparación es en tiempo constante: un === filtra información por el
 * tiempo que tarda en fallar.
 */
function firmaValida(crudo, firmaRecibida) {
  const secreto = process.env.PATREON_WEBHOOK_SECRET;
  if (!secreto || !firmaRecibida) return false;
  const esperada = crypto.createHmac('md5', secreto).update(crudo).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(firmaRecibida), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** El tier que corresponde al evento recibido. */
function tierDelEvento(evento, data) {
  // Una baja deja a la persona sin acceso, sin mirar el monto.
  if (evento.endsWith(':delete')) return 'free';

  const a = data?.attributes || {};
  if (a.patron_status && a.patron_status !== 'active_patron') return 'free';
  return tierDesdeCentavos(a.currently_entitled_amount_cents);
}

/** El id de usuario de Patreon viene en relationships.user.data.id. */
function patreonIdDelEvento(data, included) {
  const rel = data?.relationships?.user?.data?.id;
  if (rel) return rel;
  const u = (included || []).find((i) => i.type === 'user');
  return u?.id || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  if (!process.env.PATREON_WEBHOOK_SECRET) {
    console.error('PATREON_WEBHOOK_SECRET sin definir: el webhook no puede validar firmas.');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  let crudo;
  try {
    crudo = await leerCuerpo(req);
  } catch {
    return res.status(400).json({ error: 'bad_request' });
  }

  if (!firmaValida(crudo, req.headers['x-patreon-signature'])) {
    // Sin esto cualquiera podría ascender o degradar cuentas con un POST.
    console.warn('webhook de Patreon con firma inválida');
    return res.status(401).json({ error: 'invalid_signature' });
  }

  const evento = String(req.headers['x-patreon-event'] || '');
  let cuerpo;
  try {
    cuerpo = JSON.parse(crudo.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'bad_json' });
  }

  const patreonId = patreonIdDelEvento(cuerpo.data, cuerpo.included);
  if (!patreonId) {
    console.warn('webhook sin id de usuario, evento:', evento);
    return res.status(200).json({ ok: true, skipped: 'sin_patreon_id' });
  }

  const tier = tierDelEvento(evento, cuerpo.data);

  const { data: actualizados, error } = await supabase
    .from('users')
    .update({
      tier,
      tier_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('patreon_id', patreonId)
    // Una cuenta de administración no se degrada por un evento de Patreon.
    .eq('is_admin', false)
    .select('id');

  if (error) {
    // Se devuelve 500 a propósito: Patreon reintenta, y así no se pierde
    // el cambio por una caída momentánea de la base.
    console.error('webhook: no se pudo actualizar el tier:', error.message);
    return res.status(500).json({ error: 'db_error' });
  }

  // Al perder el acceso se cierran las sesiones abiertas. El tier ya se lee
  // de la base en cada pedido, pero esto además limpia el estado del cliente
  // en la próxima carga en vez de dejarlo mostrando un plan que ya no tiene.
  if (tier === 'free' && actualizados?.length) {
    await supabase.from('sessions').delete().in('user_id', actualizados.map((u) => u.id));
  }

  console.log(`webhook ${evento}: patreon_id=${patreonId} → ${tier} (${actualizados?.length || 0} filas)`);
  return res.status(200).json({ ok: true, tier });
}
