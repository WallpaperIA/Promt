import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://wallpaperia.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'No token' });

  const { data: session, error } = await supabase
    .from('sessions')
    .select('expires_at, users(tier, full_name, email)')
    .eq('token', token)
    .single();

  if (error || !session) return res.status(401).json({ error: 'Invalid session' });
  if (new Date(session.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired' });

  const user = session.users;
  res.status(200).json({ tier: user.tier, name: user.full_name, email: user.email });
}
