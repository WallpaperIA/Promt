import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { REDIRECT_URI, APP_URL } from '../_config.js';
import { COOKIE_SESION, leerCookie, COOKIE_VUELTA, cookieTemporal } from '../_cookie.js';
import { resolveTier } from '../_sesion.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  // Quien ya tiene una sesión válida y toca "Entrar" desde el enlace público
  // vuelve a su cuenta sin pasar por Patreon. Repetir el OAuth no sumaba
  // nada y el callback borra todas sus sesiones: se le cerraba la cuenta en
  // los otros dispositivos. Se lee la cookie directo y no con bearer():
  // esta es una navegación de primer nivel que llega desde GitHub Pages
  // (cross-site), y sólo decide a dónde redirigir, sin escribir nada.
  const token = leerCookie(req, COOKIE_SESION);
  if (typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    try {
      const sesion = await resolveTier(supabase, token);
      if (sesion.userId != null) return res.redirect(APP_URL);
    } catch {
      // Si la base no responde se sigue con el login normal.
    }
  }

  // state anti-CSRF: sin esto, un atacante puede forzar a la víctima a
  // completar el login contra la cuenta de Patreon del atacante.
  // Va en cookie HttpOnly del mismo dominio que el callback; SameSite=Lax
  // alcanza porque el callback llega como navegación GET de primer nivel.
  const state = crypto.randomBytes(16).toString('hex');
  // Si el login sale del enlace público, un error o una cancelación vuelven
  // ahí: sus personajes y ajustes viven en ese origen, no en el de la cuenta.
  // Sólo se acepta este valor fijo; el destino nunca sale del pedido.
  const desdePublico = req.query?.desde === 'publico';
  res.setHeader('Set-Cookie', [
    cookieTemporal('oauth_state', state, 600),
    cookieTemporal(COOKIE_VUELTA, desdePublico ? 'publico' : '', desdePublico ? 600 : 0),
  ]);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.PATREON_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'identity identity[email] identity.memberships',
    state,
  });
  res.redirect(`https://www.patreon.com/oauth2/authorize?${params}`);
}
