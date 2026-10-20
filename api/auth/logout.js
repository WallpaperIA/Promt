import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';
import { bearer } from '../_sesion.js';
import { hashSesion, exigirOrigenSesion, borrarCookieSesion } from '../_cookie.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!exigirOrigenSesion(req, res)) return;

  const token = bearer(req);
  if (token) {
    const { error } = await supabase.from('sessions').delete().eq('token', hashSesion(token));
    if (error) return res.status(503).json({ error: 'logout_unavailable' });
  }
  borrarCookieSesion(res);

  res.status(200).json({ ok: true });
}
