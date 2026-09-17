import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { FREE_WEEKLY_LIMIT, currentWeek, buildRotation, canAccess } from './_access.js';
import { applyCors } from './_cors.js';
import { bearer, resolveTier as resolverSesion } from './_sesion.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/** Cachea el catálogo entre invocaciones calientes: cambia sólo con un re-seed. */
let catalogCache = null;
let catalogCachedAt = 0;
const CATALOG_TTL_MS = 5 * 60 * 1000;

async function getCategories() {
  if (catalogCache && Date.now() - catalogCachedAt < CATALOG_TTL_MS) return catalogCache;
  const { data, error } = await supabase
    .from('categories')
    .select('id, tier, sort_order, ready, status')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`catálogo: ${error.message}`);
  // PostgREST corta en 1000 filas. Hoy son ~210 categorías, pero si alguna vez
  // pasan las 1000 hay que paginar acá como en api/catalog.js: una lista
  // truncada cambiaría la rotación semanal y el servidor dejaría de decidir
  // igual que el cliente. Ya mordió una vez en prompt_bodies, que son 1188.
  if (data.length >= 1000) throw new Error('catálogo truncado: hay que paginar');
  catalogCache = data.map((c) => ({ id: c.id, tier: c.tier, ready: c.ready, status: c.status }));
  catalogCachedAt = Date.now();
  return catalogCache;
}

/**
 * Identidad para el cupo free. Con sesión, el token; sin sesión, la IP.
 * Siempre hasheado con un salt del servidor para no guardar IPs en claro.
 * Limitación conocida: detrás de un NAT compartido (datos móviles, una
 * oficina) varios anónimos comparten cupo.
 */
function quotaBucket(req, token) {
  const salt = process.env.USAGE_SALT || '';
  if (token) return 'sess:' + crypto.createHmac('sha256', salt).update(token).digest('hex').slice(0, 32);
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.socket?.remoteAddress || 'unknown';
  return 'ip:' + crypto.createHmac('sha256', salt).update(ip).digest('hex').slice(0, 32);
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  // Respuesta distinta por usuario: que no la cachee ningún proxy.
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (!process.env.USAGE_SALT) {
    console.error('USAGE_SALT sin definir: los buckets de cupo serían predecibles.');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id || id.length > 100) return res.status(400).json({ error: 'bad_request' });

  try {
    const { tier, token, admin } = await resolverSesion(supabase, bearer(req));
    const categories = await getCategories();
    const cat = categories.find((c) => c.id === id);

    if (!cat) return res.status(404).json({ error: 'not_found' });

    // Sin publicar no existe para nadie salvo el admin, que necesita poder
    // previsualizar el borrador exactamente como lo verá un suscriptor.
    if (cat.status !== 'publicada' && !admin) {
      return res.status(404).json({ error: 'not_found' });
    }

    const week = currentWeek();
    const rotation = buildRotation(categories.filter((c) => c.status === 'publicada'), week);
    const verdict = canAccess(cat, tier, rotation);

    if (!verdict.ok) {
      return res.status(403).json({ error: verdict.reason, tier });
    }

    // Cupo semanal del tier free, contado por prompt distinto.
    let quotaUsed = null;
    if (verdict.countsAgainstQuota) {
      const { data, error } = await supabase.rpc('consume_free_quota', {
        p_bucket: quotaBucket(req, token),
        p_week: week,
        p_cat_id: id,
        p_limit: FREE_WEEKLY_LIMIT,
      });
      if (error) throw new Error(`cupo: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : data;
      quotaUsed = row?.used ?? null;
      if (!row?.allowed) {
        return res.status(429).json({
          error: 'quota_exceeded',
          tier,
          used: quotaUsed,
          limit: FREE_WEEKLY_LIMIT,
        });
      }
    }

    const { data: rows, error } = await supabase
      .from('prompt_bodies')
      .select('variant, body')
      .eq('cat_id', id);
    if (error) throw new Error(`prompts: ${error.message}`);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });

    const prompts = {};
    for (const r of rows) prompts[r.variant] = r.body;

    return res.status(200).json({
      id,
      tier,
      prompts,
      ...(quotaUsed === null ? {} : { used: quotaUsed, limit: FREE_WEEKLY_LIMIT }),
    });
  } catch (e) {
    // El detalle va al log de Vercel, no a la respuesta.
    console.error('GET /api/prompt', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
