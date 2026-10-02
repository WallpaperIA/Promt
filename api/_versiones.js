import { randomUUID } from 'node:crypto';
import { applyCors } from './_cors.js';
import { bearer, resolveTier } from './_sesion.js';

const META = 'id, cat_id, variant, title, revision, created_at, updated_at';
const ARIDAD = { prompt: 1, prompt2: 1, duoPrompt: 2, duoPrompt2: 2, trioPrompt: 3, trioPrompt2: 3 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGINA = 50;
// Tope de copias por cuenta. Sin él, una sola cuenta Full podía llenar la base
// con plantillas de 20.000 caracteres: el plan gratis de Supabase es de 500 MB.
export const MAX_VERSIONES = 100;

function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  try { const b = JSON.parse(req.body || '{}'); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; }
  catch { return {}; }
}

function validar(b) {
  if (typeof b.cat_id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(b.cat_id)) return false;
  if (!Object.hasOwn(ARIDAD, b.variant)) return false;
  if (typeof b.title !== 'string' || !b.title.trim() || b.title.trim().length > 80 || /[\x00-\x1f\x7f]/.test(b.title)) return false;
  if (typeof b.body !== 'string' || !b.body.trim() || b.body.length > 20000 || /\x00/.test(b.body)) return false;
  const n = ARIDAD[b.variant];
  const nombres = n === 1 ? ['__N__'] : Array.from({ length: n }, (_, i) => `__N${i + 1}__`);
  const permitidos = new Set(nombres.flatMap(m => [m, m.replace(/__$/, '_HAIR__'), m.replace(/__$/, '_FEATURES__')]));
  // Se guardan plantillas: un nombre concreto rompería el cambio de personaje
  // al copiar y podría subir un dato que siempre debe quedarse en el equipo.
  return nombres.every(m => b.body.includes(m)) && (b.body.match(/__[A-Za-z0-9_]+__/g) || []).every(m => permitidos.has(m));
}

function falloDB(error) {
  if (error) throw error;
}

/** La fábrica permite probar el handler real con dos cuentas sin usar datos privados. */
export function crearHandlerVersiones(supabase) {
  return async function handler(req, res) {
    applyCors(req, res, 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });

    try {
      const sesion = await resolveTier(supabase, bearer(req));
      if (!sesion.token || sesion.userId == null) return res.status(401).json({ error: 'invalid_session' });
      const id = typeof req.query?.id === 'string' ? req.query.id : '';
      if (id && !UUID.test(id)) return res.status(400).json({ error: 'bad_request' });

      // Bajar de plan conserva las copias y permite ver sus títulos o borrarlas.
      // Leer el texto, crear y editar siguen siendo beneficios de Full/VIP.
      if (sesion.tier !== 'full' && (req.method === 'POST' || req.method === 'PUT' || (req.method === 'GET' && id))) {
        return res.status(403).json({ error: 'needs_full' });
      }

      if (req.method === 'GET') {
        if (id) {
          const { data, error } = await supabase.from('prompt_versions').select(META + ', body')
            .eq('user_id', sesion.userId).eq('id', id).maybeSingle();
          falloDB(error);
          if (!data) return res.status(404).json({ error: 'not_found' });
          return res.status(200).json({ version: data });
        }
        const offset = Number(req.query?.offset ?? 0);
        const cat = typeof req.query?.cat_id === 'string' ? req.query.cat_id : '';
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || cat.length > 100) return res.status(400).json({ error: 'bad_request' });
        let q = supabase.from('prompt_versions').select(META).eq('user_id', sesion.userId);
        if (cat) q = q.eq('cat_id', cat);
        const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + PAGINA);
        falloDB(error);
        return res.status(200).json({ versiones: data.slice(0, PAGINA), mas: data.length > PAGINA, tier: sesion.tier });
      }

      if (req.method === 'DELETE') {
        if (!id) return res.status(400).json({ error: 'bad_request' });
        // Incluso un admin sólo administra SUS copias. El permiso de catálogo
        // no es permiso para leer ni cambiar la biblioteca de otra persona.
        const { data, error } = await supabase.from('prompt_versions').delete()
          .eq('user_id', sesion.userId).eq('id', id).select('id').maybeSingle();
        falloDB(error);
        if (!data) return res.status(404).json({ error: 'not_found' });
        return res.status(200).json({ ok: true });
      }

      const b = leerCuerpo(req);
      if (!validar(b) || (req.method === 'PUT' && (!id || !Number.isSafeInteger(b.revision) || b.revision < 1))) {
        return res.status(400).json({ error: 'invalid_template' });
      }
      if (req.method === 'POST') {
        const { data: cat, error: catError } = await supabase.from('categories').select('id, ready, status')
          .eq('id', b.cat_id).maybeSingle();
        falloDB(catError);
        if (!cat || !cat.ready || (cat.status !== 'publicada' && !sesion.admin)) return res.status(404).json({ error: 'not_found' });
        const { data: fuente, error: fuenteError } = await supabase.from('prompt_bodies').select('cat_id')
          .eq('cat_id', b.cat_id).eq('variant', b.variant).maybeSingle();
        falloDB(fuenteError);
        if (!fuente) return res.status(404).json({ error: 'not_found' });
        // Dos pedidos simultáneos pueden pasarse por una o dos: es un freno
        // contra llenar la base, no una cuenta exacta.
        const { count, error: cuentaError } = await supabase.from('prompt_versions')
          .select('id', { count: 'exact', head: true }).eq('user_id', sesion.userId);
        falloDB(cuentaError);
        if (count >= MAX_VERSIONES) return res.status(409).json({ error: 'version_limit' });
      } else {
        const { data: anterior, error } = await supabase.from('prompt_versions').select('cat_id, variant')
          .eq('user_id', sesion.userId).eq('id', id).maybeSingle();
        falloDB(error);
        if (!anterior) return res.status(404).json({ error: 'not_found' });
        // La asociación a escena/variante no cambia al renombrar o editar:
        // cambiarla podría aplicar un trío donde el generador espera un solo.
        if (anterior.cat_id !== b.cat_id || anterior.variant !== b.variant) return res.status(400).json({ error: 'invalid_template' });
      }

      const campos = { title: b.title.trim(), body: b.body.trim(), updated_at: new Date().toISOString() };
      let q;
      if (req.method === 'POST') {
        q = supabase.from('prompt_versions').insert({ ...campos, id: randomUUID(), user_id: sesion.userId,
          cat_id: b.cat_id, variant: b.variant, revision: 1 });
      } else {
        // El número de revisión evita pisar cambios hechos desde otro equipo.
        q = supabase.from('prompt_versions').update({ ...campos, revision: b.revision + 1 })
          .eq('user_id', sesion.userId).eq('id', id).eq('revision', b.revision);
      }
      const { data, error } = await q.select(META + ', body').maybeSingle();
      falloDB(error);
      if (!data) return res.status(409).json({ error: 'version_conflict' });
      return res.status(req.method === 'POST' ? 201 : 200).json({ version: data });
    } catch (e) {
      // Ni el texto privado ni el identificador de cuenta van al registro.
      console.error('/api/versiones', e.code || 'database_error');
      const faltaTabla = ['42P01', 'PGRST205'].includes(e.code);
      return res.status(faltaTabla ? 503 : 500).json({ error: faltaTabla ? 'storage_unavailable' : 'server_error' });
    }
  };
}
