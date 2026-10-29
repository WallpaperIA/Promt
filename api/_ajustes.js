import { bearer, resolveTier } from './_sesion.js';
import { exigirOrigenSesion } from './_cookie.js';
import { applyCors } from './_cors.js';
import { validarAjustes, MAX_AJUSTES_BYTES } from '../assets/ajustes-datos.js';

export function crearHandlerAjustes(db) {
  return async function handler(req, res) {
    applyCors(req, res, 'GET, PATCH, OPTIONS');
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!['GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
    if (!exigirOrigenSesion(req, res)) return;
    try {
      const sesion = await resolveTier(db, bearer(req));
      if (!sesion.token || !sesion.userId) return res.status(401).json({ error: 'invalid_session' });
      // El dueño sale únicamente de la cookie; ningún tier ni rol da acceso ajeno.
      const leer = async () => {
        const { data, error } = await db.from('user_settings').select('settings, revision, updated_at')
          .eq('user_id', sesion.userId).maybeSingle();
        if (error) throw error;
        return data || { settings: {}, revision: 0, updated_at: null };
      };
      const responder = (codigo, fila, error) => res.status(codigo).json({
        accountId: sesion.userId, settings: fila.settings, revision: fila.revision,
        updatedAt: fila.updated_at, ...(error ? { error } : {}),
      });
      if (req.method === 'GET') return responder(200, await leer());
      const b = req.body;
      if (!b || typeof b !== 'object' || Array.isArray(b) ||
          Object.keys(b).some(k => !['accountId', 'revision', 'changes'].includes(k)) ||
          !Number.isSafeInteger(b.revision) || b.revision < 0 || !validarAjustes(b.changes)) {
        return res.status(400).json({ error: 'invalid_settings' });
      }
      // Si otra pestaña cambió la cookie, jamás guardar el perfil anterior en
      // la cuenta nueva. Esta marca es una precondición, no una autorización.
      if (b.accountId !== sesion.userId) return res.status(409).json({ error: 'account_changed' });
      const actual = await leer();
      if (actual.revision !== b.revision) return responder(409, actual, 'revision_conflict');
      if (!Object.keys(b.changes).length) return responder(200, actual);
      if (actual.updated_at && Date.now() - new Date(actual.updated_at).getTime() < 1000) {
        res.setHeader('Retry-After', '1');
        return res.status(429).json({ error: 'settings_rate_limited' });
      }
      const settings = { ...actual.settings };
      for (const [k, v] of Object.entries(b.changes)) {
        if (v === null) delete settings[k]; else settings[k] = v;
      }
      if (!validarAjustes(settings) || Buffer.byteLength(JSON.stringify(settings)) > MAX_AJUSTES_BYTES) {
        return res.status(413).json({ error: 'settings_too_large' });
      }
      const fila = { settings, revision: actual.revision + 1, updated_at: new Date().toISOString() };
      let resultado;
      if (actual.revision === 0) {
        resultado = await db.from('user_settings').insert({ user_id: sesion.userId, ...fila })
          .select('settings, revision, updated_at').single();
      } else {
        resultado = await db.from('user_settings').update(fila).eq('user_id', sesion.userId)
          .eq('revision', actual.revision).select('settings, revision, updated_at').maybeSingle();
      }
      if (resultado.error?.code === '23505' || (!resultado.error && !resultado.data)) {
        return responder(409, await leer(), 'revision_conflict');
      }
      if (resultado.error) throw resultado.error;
      return responder(200, resultado.data);
    } catch (e) {
      // Sólo códigos técnicos: ni personajes, preferencias, textos o cookies.
      console.error('/api/ajustes', e.code || 'settings_unavailable');
      return res.status(503).json({ error: 'settings_unavailable' });
    }
  };
}
