import crypto from 'crypto';
import { REDIRECT_URI } from '../_config.js';

export default function handler(req, res) {
  // state anti-CSRF: sin esto, un atacante puede forzar a la víctima a
  // completar el login contra la cuenta de Patreon del atacante.
  // Va en cookie HttpOnly del mismo dominio que el callback; SameSite=Lax
  // alcanza porque el callback llega como navegación GET de primer nivel.
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader(
    'Set-Cookie',
    `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
  );

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.PATREON_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'identity identity[email] identity.memberships',
    state,
  });
  res.redirect(`https://www.patreon.com/oauth2/authorize?${params}`);
}
