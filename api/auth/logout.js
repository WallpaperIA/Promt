import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../_cors.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token } = req.body || {};
  if (token) await supabase.from('sessions').delete().eq('token', token);

  res.status(200).json({ ok: true });
}
