import { createClient } from '@supabase/supabase-js';
import { REDIRECT_URI, APP_URL } from '../_config.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Patreon campaign tier IDs → our tier names
// These IDs come from Patreon API — we match by amount_cents as fallback
const TIER_MAP = {
  700:  'premium', // $7
  1000: 'full',    // $10
};

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export default async function handler(req, res) {
  const { code, error, state } = req.query;

  if (error || !code) {
    return res.redirect(`${APP_URL}?auth=error`);
  }

  // Validar el state emitido en /api/auth/login (anti-CSRF) y quemar la cookie.
  const expectedState = readCookie(req, 'oauth_state');
  res.setHeader('Set-Cookie', 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  if (!state || !expectedState || state !== expectedState) {
    return res.redirect(`${APP_URL}?auth=error`);
  }

  try {
    // 1. Exchange code for token
    const tokenRes = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: process.env.PATREON_CLIENT_ID,
        client_secret: process.env.PATREON_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access token');

    // 2. Get user identity + memberships
    const identityRes = await fetch(
      'https://www.patreon.com/api/oauth2/v2/identity?fields[user]=email,full_name&include=memberships&fields[member]=currently_entitled_amount_cents,patron_status',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    const identity = await identityRes.json();

    const patreonId = identity.data?.id;
    const email = identity.data?.attributes?.email;
    const fullName = identity.data?.attributes?.full_name;

    if (!patreonId) throw new Error('No patreon ID');

    // 3. Determine tier from memberships
    let tier = 'free';
    const memberships = identity.included?.filter(i => i.type === 'member') || [];
    for (const m of memberships) {
      const { patron_status, currently_entitled_amount_cents } = m.attributes;
      if (patron_status === 'active_patron') {
        const mapped = TIER_MAP[currently_entitled_amount_cents];
        if (mapped === 'full') { tier = 'full'; break; }
        if (mapped === 'premium') tier = 'premium';
      }
    }

    // 4. Upsert user in Supabase
    const { data: user, error: upsertErr } = await supabase
      .from('users')
      .upsert({ patreon_id: patreonId, email, full_name: fullName, tier, updated_at: new Date().toISOString() }, { onConflict: 'patreon_id' })
      .select()
      .single();
    if (upsertErr) throw upsertErr;

    // 5. Create session token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await supabase.from('sessions').insert({ user_id: user.id, token, expires_at: expiresAt.toISOString() });

    // 6. Redirect to app with token
    res.redirect(`${APP_URL}?session=${token}`);
  } catch (e) {
    console.error('Auth error:', e);
    res.redirect(`${APP_URL}?auth=error`);
  }
}
