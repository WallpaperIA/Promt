import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';
import { exigirAdmin } from '../_admin.js';
import { validarCategoria, VARIANTES } from '../_validar.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Panel de administración de categorías.
 *
 *   GET    ?status=borrador     lista (todas si no se filtra)
 *   GET    ?id=xxx              una, con sus prompts
 *   POST   {categoria}          crea un borrador
 *   PUT    {id, ...}            edita
 *   POST   ?accion=probar       registra la prueba manual
 *   POST   ?accion=publicar     publica, si pasó todo
 *   POST   ?accion=despublicar  vuelve a borrador
 *   DELETE ?id=xxx              borra (sólo si no está publicada)
 *   DELETE ?id=xxx&definitivo=1 borra para siempre, esté publicada o no,
 *                               y deja el id en deleted_categories
 *
 * Todo exige is_admin. El cliente nunca declara su permiso: manda un token
 * de sesión y el permiso se lee de la base.
 */

const CAMPOS = 'id, tier, sort_order, ready, status, name, sub, tested_at, tested_note, created_at, updated_at';

async function traerPrompts(catId) {
  const { data, error } = await supabase
    .from('prompt_bodies')
    .select('variant, body')
    .eq('cat_id', catId);
  if (error) throw new Error(error.message);
  const out = {};
  for (const r of data) out[r.variant] = r.body;
  return out;
}

/** Deja en prompt_bodies exactamente las variantes recibidas. */
async function guardarPrompts(catId, prompts) {
  const filas = VARIANTES
    .filter((v) => typeof prompts[v] === 'string' && prompts[v].trim())
    .map((v) => ({ cat_id: catId, variant: v, body: prompts[v].trim() }));

  const { error: delErr } = await supabase.from('prompt_bodies').delete().eq('cat_id', catId);
  if (delErr) throw new Error(delErr.message);

  if (filas.length) {
    const { error } = await supabase.from('prompt_bodies').insert(filas);
    if (error) throw new Error(error.message);
  }
}

function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await exigirAdmin(supabase, req, res);
  if (!admin) return;

  try {
    // ── Listar / leer una ──────────────────────────────────────
    if (req.method === 'GET') {
      const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
      if (id) {
        const { data, error } = await supabase.from('categories').select(CAMPOS).eq('id', id).single();
        if (error || !data) return res.status(404).json({ error: 'no_encontrada' });
        return res.status(200).json({ categoria: { ...data, prompts: await traerPrompts(id) } });
      }

      let q = supabase.from('categories').select(CAMPOS).order('updated_at', { ascending: false });
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return res.status(200).json({ categorias: data });
    }

    const cuerpo = leerCuerpo(req);
    const accion = typeof req.query.accion === 'string' ? req.query.accion : '';

    // ── Acciones sobre una categoría existente ─────────────────
    if (req.method === 'POST' && accion) {
      const id = String(cuerpo.id || '').trim();
      if (!id) return res.status(400).json({ error: 'falta_id' });

      const { data: cat, error } = await supabase.from('categories').select(CAMPOS).eq('id', id).single();
      if (error || !cat) return res.status(404).json({ error: 'no_encontrada' });

      if (accion === 'probar') {
        // La prueba manual: el admin confirma que generó la imagen y sirve.
        // Antes hay que pasar igual las verificaciones automáticas, para no
        // dar por buena una categoría que ni siquiera renderiza.
        const prompts = await traerPrompts(id);
        const v = validarCategoria({ ...cat, prompts });
        if (!v.ok) {
          return res.status(400).json({ error: 'no_pasa_verificaciones', errores: v.errores, avisos: v.avisos });
        }
        const { error: upErr } = await supabase
          .from('categories')
          .update({
            status: 'prueba',
            tested_at: new Date().toISOString(),
            tested_note: String(cuerpo.nota || '').slice(0, 500) || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
        if (upErr) throw new Error(upErr.message);
        return res.status(200).json({ ok: true, status: 'prueba' });
      }

      if (accion === 'publicar') {
        // Dos condiciones: que pase las verificaciones AHORA (no cuando se
        // probó: pudo editarse después) y que exista la prueba manual.
        const prompts = await traerPrompts(id);
        const v = validarCategoria({ ...cat, prompts });
        if (!v.ok) {
          return res.status(400).json({ error: 'no_pasa_verificaciones', errores: v.errores, avisos: v.avisos });
        }
        if (!cat.tested_at) {
          return res.status(400).json({ error: 'sin_prueba_manual' });
        }
        const { error: upErr } = await supabase
          .from('categories')
          .update({ status: 'publicada', ready: true, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (upErr) throw new Error(upErr.message);
        return res.status(200).json({ ok: true, status: 'publicada' });
      }

      if (accion === 'despublicar') {
        const { error: upErr } = await supabase
          .from('categories')
          .update({ status: 'borrador', updated_at: new Date().toISOString() })
          .eq('id', id);
        if (upErr) throw new Error(upErr.message);
        return res.status(200).json({ ok: true, status: 'borrador' });
      }

      return res.status(400).json({ error: 'accion_desconocida' });
    }

    // ── Crear ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { data: existentes } = await supabase.from('categories').select('id');
      const ids = (existentes || []).map((c) => c.id);

      const v = validarCategoria(cuerpo, ids);
      // Un borrador se guarda aunque tenga errores: la idea es poder dejarlo
      // a medias y volver. Lo que exige estar bien es publicar.
      if (!cuerpo.id || ids.includes(String(cuerpo.id).trim())) {
        return res.status(400).json({ error: 'id_invalido_o_repetido', errores: v.errores });
      }

      const { data: ultimo } = await supabase
        .from('categories').select('sort_order').order('sort_order', { ascending: false }).limit(1);
      const sortOrder = (ultimo?.[0]?.sort_order ?? -1) + 1;

      const { error } = await supabase.from('categories').insert({
        id: String(cuerpo.id).trim(),
        tier: cuerpo.tier || 'casual',
        name: cuerpo.name || null,
        sub: cuerpo.sub || null,
        sort_order: sortOrder,
        ready: false,
        status: 'borrador',
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);

      await guardarPrompts(String(cuerpo.id).trim(), cuerpo.prompts || {});
      return res.status(201).json({ ok: true, id: cuerpo.id, validacion: v });
    }

    // ── Editar ─────────────────────────────────────────────────
    if (req.method === 'PUT') {
      const id = String(cuerpo.id || '').trim();
      if (!id) return res.status(400).json({ error: 'falta_id' });

      const { data: cat, error } = await supabase.from('categories').select(CAMPOS).eq('id', id).single();
      if (error || !cat) return res.status(404).json({ error: 'no_encontrada' });

      const cambios = { updated_at: new Date().toISOString() };
      for (const campo of ['tier', 'name', 'sub']) {
        if (campo in cuerpo) cambios[campo] = cuerpo[campo];
      }

      // Editar invalida la prueba anterior: lo aprobado ya no es lo que hay.
      if (cuerpo.prompts || 'tier' in cuerpo) {
        cambios.tested_at = null;
        cambios.tested_note = null;
        if (cat.status === 'prueba') cambios.status = 'borrador';
      }

      const { error: upErr } = await supabase.from('categories').update(cambios).eq('id', id);
      if (upErr) throw new Error(upErr.message);

      if (cuerpo.prompts) await guardarPrompts(id, cuerpo.prompts);

      const prompts = await traerPrompts(id);
      return res.status(200).json({
        ok: true,
        validacion: validarCategoria({ ...cat, ...cambios, prompts }),
        pruebaInvalidada: !!cambios.tested_at === false && !!cat.tested_at,
      });
    }

    // ── Borrar ─────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
      if (!id) return res.status(400).json({ error: 'falta_id' });

      // ?definitivo=1 viene de la papelera: el admin ya confirmó por nombre y
      // quiere que desaparezca, esté publicada o no. Sin eso se mantiene el
      // paso de despublicar primero, que existe para no borrar de un clic algo
      // que los suscriptores están usando.
      const definitivo = req.query.definitivo === '1';

      const { data: cat } = await supabase.from('categories').select('status').eq('id', id).single();
      if (!cat) return res.status(404).json({ error: 'no_encontrada' });
      if (cat.status === 'publicada' && !definitivo) {
        return res.status(400).json({ error: 'despublicar_primero' });
      }

      // La lápida va ANTES de borrar. Si el proceso se corta entre medio,
      // sobra un id marcado como eliminado —la categoría desaparece y se
      // puede recuperar corriendo el seed sin la lápida—, que es mucho mejor
      // que el otro orden: ahí quedaría borrada sin que nadie lo sepa, y el
      // navegador la seguiría mostrando rota.
      const { error: lapErr } = await supabase
        .from('deleted_categories')
        .upsert({ id, deleted_at: new Date().toISOString() }, { onConflict: 'id' });
      if (lapErr) throw new Error(lapErr.message);

      await supabase.from('prompt_bodies').delete().eq('cat_id', id);
      const { error: delErr } = await supabase.from('categories').delete().eq('id', id);
      if (delErr) throw new Error(delErr.message);
      return res.status(200).json({ ok: true, eliminada: id });
    }

    return res.status(405).json({ error: 'metodo_no_permitido' });
  } catch (e) {
    console.error('admin/categories', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
