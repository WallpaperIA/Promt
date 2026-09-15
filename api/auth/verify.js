import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'No token' });

  const { data: session, error } = await supabase
    .from('sessions')
    .select('expires_at, users(tier, full_name)')
    .eq('token', token)
    .single();

  if (error || !session) return res.status(401).json({ error: 'Invalid session' });
  if (new Date(session.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired' });

  // Sólo lo que el frontend realmente usa. El email es PII que no hace falta
  // exponer al cliente (y quedaba guardado en cualquier proxy intermedio).
  const user = session.users;
  res.status(200).json({ tier: user.tier, name: user.full_name });
}
