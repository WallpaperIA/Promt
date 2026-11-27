import { createClient } from '@supabase/supabase-js';
import { canAccess } from './_access.js';
import { applyCors } from './_cors.js';
import { bearer, resolveTier as resolverSesion } from './_sesion.js';
import { limitar } from './_limite.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Hasta cuántas escenas "todas" pide por id. Con más se traen todas las v1 y
 * se filtra acá: con .in() de ~200 ids la dirección del pedido a Supabase se
 * haría muy larga.
 */
const MAX_IDS_POR_PEDIDO = 50;

/**
 * Los textos, en la memoria de cada instancia por un minuto. Sólo los
 * textos: el permiso (escena publicada, tier) se sigue leyendo de la base en
 * cada pedido, así despublicar o subir de nivel una escena corta enseguida.
 * Sin esto, un dispositivo con cuenta Full que repitiera "Un nombre en
 * todas" leía ~350 KB de Supabase en cada pedido. El admin siempre lee de la
 * base: es quien edita y previsualiza. Un texto editado tarda hasta un
 * minuto en llegar a los demás.
 */
const CACHE_TEXTOS_MS = 60 * 1000;
/** Tope de escenas con todas sus variantes en memoria (~15 KB cada una). */
const MAX_ESCENAS_EN_MEMORIA = 600;
const v1PorEscena = new Map();          // id → { creado, body }
const variantesPorEscena = new Map();   // id → { creado, prompts }
const vigente = (entrada, ahora) => !!entrada && ahora >= entrada.creado && ahora - entrada.creado < CACHE_TEXTOS_MS;

/** El panel puede cambiar tier o estado: esos permisos no admiten caché. */
async function getCategories(id) {
  let query = supabase
    .from('categories')
    .select('id, tier, sort_order, ready, status')
    .order('sort_order', { ascending: true });
  // Para abrir una escena sólo hace falta su fila; el paquete de todas sí
  // necesita el catálogo entero. Ambos leen el permiso vigente de la base.
  if (id) query = query.eq('id', id);
  const { data, error } = await query;
  if (error) throw new Error(`catálogo: ${error.message}`);
  // PostgREST corta en 1000 filas. Hoy son ~210 categorías, pero si alguna vez
  // pasan las 1000 hay que paginar acá como en api/catalog.js: una categoría
  // que quedara fuera de la lista respondería 404 aunque exista. Ya mordió
  // una vez en prompt_bodies, que son 1188.
  if (data.length >= 1000) throw new Error('catálogo truncado: hay que paginar');
  return data.map((c) => ({ id: c.id, tier: c.tier, ready: c.ready, status: c.status }));
}

/**
 * GET /api/prompt?todas=1 — la versión Solo v1 de cada escena que el plan
 * alcanza, en un solo pedido.
 *
 * La usa "Un nombre en todas". Antes armaba sólo las escenas que ya se
 * habían abierto en ese navegador, porque los prompts se bajan de a uno al
 * abrir cada escena: alguien nuevo que lo probaba recibía 0. Pedirlas de a
 * una serían ~200 pedidos.
 *
 * Sólo la v1 Solo, que es lo único que esa función usa: así pesa unos
 * 350 KB y no los 2 MB de las seis variantes. El acceso se decide igual que
 * en el pedido de a una: resolveTier() y canAccess(), nunca lo que diga el
 * cliente.
 */
async function todas(req, res) {
  const { tier, admin } = await resolverSesion(supabase, bearer(req));
  const categories = await getCategories();
  const permitidas = new Set(
    categories
      .filter((c) => (c.status === 'publicada' || admin) && canAccess(c, tier).ok)
      .map((c) => c.id)
  );

  if (!permitidas.size) return res.status(200).json({ tier, prompts: {} });

  // Sólo se le piden a la base los textos que el plan puede recibir y que
  // no estén ya en memoria. Hasta el 21/10/2026 se traían siempre todas las
  // v1: sin cuenta, para entregar las cinco gratis, cada pedido leía cientos
  // de KB de Supabase, y un script que lo repitiera gastaba la transferencia
  // mensual del plan.
  const ahora = Date.now();
  const leidos = new Map();
  const faltan = admin ? [...permitidas] : [...permitidas].filter((id) => !vigente(v1PorEscena.get(id), ahora));
  if (faltan.length) {
    let consulta = supabase
      .from('prompt_bodies')
      .select('cat_id, body')
      .eq('variant', 'prompt');
    if (faltan.length <= MAX_IDS_POR_PEDIDO) consulta = consulta.in('cat_id', faltan);
    const { data: rows, error } = await consulta;
    if (error) throw new Error(`prompts: ${error.message}`);
    // Mismo tope que el catálogo: PostgREST corta en 1000 filas.
    if (rows.length >= 1000) throw new Error('prompts truncados: hay que paginar');
    for (const r of rows) {
      if (!permitidas.has(r.cat_id)) continue;
      leidos.set(r.cat_id, r.body);
      if (!admin) v1PorEscena.set(r.cat_id, { creado: ahora, body: r.body });
    }
  }

  const prompts = {};
  for (const id of permitidas) {
    const body = leidos.has(id) ? leidos.get(id) : (admin ? undefined : v1PorEscena.get(id)?.body);
    if (body != null) prompts[id] = body;
  }
  return res.status(200).json({ tier, prompts });
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  // Respuesta distinta por usuario: que no la cachee ningún proxy.
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (req.query.todas === '1') {
    // Es el pedido más pesado (todas las escenas del plan): diez por minuto
    // alcanzan para usar "Un nombre en todas" las veces que haga falta.
    if (limitar(req, res, 'prompt-todas', 10)) return;
    try {
      return await todas(req, res);
    } catch (e) {
      console.error('GET /api/prompt?todas=1', e);
      return res.status(500).json({ error: 'server_error' });
    }
  }

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id || id.length > 100) return res.status(400).json({ error: 'bad_request' });
  if (limitar(req, res, 'prompt', 120)) return;

  try {
    const { tier, admin } = await resolverSesion(supabase, bearer(req));
    const categories = await getCategories(id);
    const cat = categories.find((c) => c.id === id);

    if (!cat) return res.status(404).json({ error: 'not_found' });

    // Sin publicar no existe para nadie salvo el admin, que necesita poder
    // previsualizar el borrador exactamente como lo verá un suscriptor.
    if (cat.status !== 'publicada' && !admin) {
      return res.status(404).json({ error: 'not_found' });
    }

    const verdict = canAccess(cat, tier);
    if (!verdict.ok) {
      return res.status(403).json({ error: verdict.reason, tier });
    }

    // El permiso ya se comprobó con la fila actual; el texto puede salir de
    // la memoria (ver CACHE_TEXTOS_MS).
    const ahora = Date.now();
    const enMemoria = admin ? null : variantesPorEscena.get(id);
    let prompts;
    if (vigente(enMemoria, ahora)) {
      prompts = enMemoria.prompts;
    } else {
      const { data: rows, error } = await supabase
        .from('prompt_bodies')
        .select('variant, body')
        .eq('cat_id', id);
      if (error) throw new Error(`prompts: ${error.message}`);
      if (!rows.length) return res.status(404).json({ error: 'not_found' });
      prompts = {};
      for (const r of rows) prompts[r.variant] = r.body;
      if (!admin) {
        // La más vieja sale primero: un Map recorre en orden de llegada.
        variantesPorEscena.delete(id);
        if (variantesPorEscena.size >= MAX_ESCENAS_EN_MEMORIA) variantesPorEscena.delete(variantesPorEscena.keys().next().value);
        variantesPorEscena.set(id, { creado: ahora, prompts });
      }
    }

    return res.status(200).json({
      id,
      tier,
      prompts,
    });
  } catch (e) {
    // El detalle va al log de Vercel, no a la respuesta.
    console.error('GET /api/prompt', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
