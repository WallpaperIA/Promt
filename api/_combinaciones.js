import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { applyCors } from './_cors.js';
import { bearer, resolveTier } from './_sesion.js';

// La misma fuente pública que usa build-catalog evita aceptar IDs retirados
// o mantener otra lista que se desincronice. Nunca se ejecuta texto del cliente.
const contexto = vm.createContext({});
const fuente = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'modificadores.js');
new vm.Script(readFileSync(fuente, 'utf8')
  + ';globalThis.modificadores={STYLES,OUTFITS,HAIRSTYLES,FORMATS,DETAILS};').runInContext(contexto);
const { STYLES, OUTFITS, HAIRSTYLES, FORMATS, DETAILS } = contexto.modificadores;
const META = 'id, title, created_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_COMBINACIONES = 100;

export function validarCombinacion(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const listas = { style: STYLES, outfit: OUTFITS, hair: HAIRSTYLES, format: FORMATS };
  if (Object.keys(s).length !== 5 || Object.keys(s).some(k => !Object.hasOwn(listas, k) && k !== 'details')) return false;
  if (!Object.entries(listas).every(([k, lista]) => typeof s[k] === 'string' && lista.some(m => m.id === s[k]))) return false;
  if (!Array.isArray(s.details) || s.details.length > DETAILS.length || new Set(s.details).size !== s.details.length) return false;
  const exclusiones = new Set();
  return s.details.every(id => {
    const d = DETAILS.find(m => m.id === id);
    if (!d || (d.excl && exclusiones.has(d.excl))) return false;
    if (d.excl) exclusiones.add(d.excl);
    return true;
  });
}

export function crearHandlerCombinaciones(supabase) {
  return async function handler(req, res) {
    applyCors(req, res, 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
    try {
      const sesion = await resolveTier(supabase, bearer(req));
      if (!sesion.token || sesion.userId == null) return res.status(401).json({ error: 'invalid_session' });
      const id = req.query?.id || '';
      if (typeof id !== 'string' || (id && !UUID.test(id))) return res.status(400).json({ error: 'bad_request' });
      if (sesion.tier !== 'full' && (req.method === 'POST' || (req.method === 'GET' && id))) return res.status(403).json({ error: 'needs_full' });
      if (req.method === 'GET') {
        let q = supabase.from('prompt_combinations').select(META + (id ? ', settings' : '')).eq('user_id', sesion.userId);
        if (id) q = q.eq('id', id).maybeSingle();
        else q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, MAX_COMBINACIONES);
        const { data, error } = await q;
        if (error) throw error;
        if (id && !data) return res.status(404).json({ error: 'not_found' });
        return res.status(200).json(id ? { combinacion: data } : { combinaciones: data, tier: sesion.tier });
      }
      if (req.method === 'DELETE') {
        if (!id) return res.status(400).json({ error: 'bad_request' });
        const { data, error } = await supabase.from('prompt_combinations').delete().eq('user_id', sesion.userId).eq('id', id).select('id').maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'not_found' });
        return res.status(200).json({ ok: true });
      }
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
      if (!b || typeof b.title !== 'string' || !b.title.trim() || b.title.trim().length > 80 || /[\x00-\x1f\x7f]/.test(b.title) || !validarCombinacion(b.settings)) return res.status(400).json({ error: 'invalid_combination' });
      const { count, error: cuentaError } = await supabase.from('prompt_combinations').select('id', { count: 'exact', head: true }).eq('user_id', sesion.userId);
      if (cuentaError) throw cuentaError;
      // Como en Mis versiones, es un freno al volumen, no un cupo de uso.
      // Dos creaciones simultáneas pueden superar el tope por una fila.
      if (count >= MAX_COMBINACIONES) return res.status(409).json({ error: 'combination_limit' });
      const { style, outfit, hair, format, details } = b.settings;
      const { data, error } = await supabase.from('prompt_combinations').insert({ id: randomUUID(), user_id: sesion.userId,
        title: b.title.trim(), settings: { style, outfit, hair, format, details } }).select(META).maybeSingle();
      if (error) throw error;
      return res.status(201).json({ combinacion: data });
    } catch (e) {
      console.error('/api/versiones combinaciones', e.code || 'database_error');
      const faltaTabla = ['42P01', 'PGRST205'].includes(e.code);
      return res.status(faltaTabla ? 503 : 500).json({ error: faltaTabla ? 'storage_unavailable' : 'server_error' });
    }
  };
}
