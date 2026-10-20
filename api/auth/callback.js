import { createClient } from '@supabase/supabase-js';
import { REDIRECT_URI, APP_URL, PUBLIC_APP_URL } from '../_config.js';
import { canjearCodigo, traerIdentidad, camposDeToken } from '../_patreon.js';
import { nuevaSesion, cookieSesion, leerCookie as readCookie, COOKIE_VUELTA, cookieTemporal } from '../_cookie.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const { code, error, state } = req.query;

  // Un error o una cancelación vuelven a donde empezó el login. Desde el
  // enlace público, mandarlo al origen de la cuenta lo dejaba sin sus
  // personajes ni ajustes, que quedan guardados en el otro origen. El
  // destino es una de dos constantes: la cookie sólo elige cuál.
  const urlError = (readCookie(req, COOKIE_VUELTA) === 'publico' ? PUBLIC_APP_URL : APP_URL) + '?auth=error';
  // Las dos cookies del OAuth se queman en cualquier salida.
  const quemar = [cookieTemporal('oauth_state', '', 0), cookieTemporal(COOKIE_VUELTA, '', 0)];
  res.setHeader('Set-Cookie', quemar);

  if (error || !code) {
    // access_denied es una cancelación; cualquier otro valor lo eligió Patreon.
    console.error('Auth error: patreon_devolvio', String(error || 'sin_code').replace(/[^a-z_]/gi, '').slice(0, 40));
    return res.redirect(urlError);
  }

  // Validar el state emitido en /api/auth/login (anti-CSRF).
  const expectedState = readCookie(req, 'oauth_state');
  if (!state || !expectedState || state !== expectedState) {
    console.error('Auth error: state', expectedState ? 'distinto' : 'sin_cookie');
    return res.redirect(urlError);
  }

  // El paso que falló va al registro de Vercel: sin eso, "authentication_failed"
  // no decía si era Patreon, la configuración o la base.
  let paso = 'canje';
  try {
    const tokenData = await canjearCodigo(code, REDIRECT_URI);
    paso = 'identidad';
    const ident = await traerIdentidad(tokenData.access_token);
    paso = 'usuario';

    // Los tokens se guardan para poder releer el tier más adelante sin que la
    // persona tenga que volver a entrar. Sin esto, cancelar o cambiar de plan
    // no se notaba hasta el próximo login, que podía tardar semanas.
    const { data: user, error: upsertErr } = await supabase
      .from('users')
      .upsert(
        {
          patreon_id: ident.patreonId,
          tier: ident.tier,
          patreon_campaign_id: ident.campaignId,
          // Sólo si Patreon los devolvió: si no, se pisaría lo que ya había.
          ...(ident.email ? { email: ident.email } : {}),
          ...(ident.fullName ? { full_name: ident.fullName } : {}),
          ...camposDeToken(tokenData),
          tier_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'patreon_id' }
      )
      .select()
      .single();
    if (upsertErr) throw upsertErr;

    // Las sesiones anteriores de esta persona se cierran: entrar de nuevo
    // debería dejar una sola sesión viva, no acumular una por login.
    paso = 'sesiones_anteriores';
    const { error: deleteErr } = await supabase.from('sessions').delete().eq('user_id', user.id);
    if (deleteErr) throw deleteErr;
    paso = 'sesion_nueva';

    const sesion = nuevaSesion();
    const { error: insertErr } = await supabase
      .from('sessions')
      .insert({ user_id: user.id, token: sesion.hash, expires_at: sesion.expiresAt });
    if (insertErr) throw insertErr;

    // El secreto no vuelve en URL ni en JSON. Sólo la cookie HttpOnly conoce
    // el original; una lectura de la tabla tampoco permite reutilizar su hash.
    res.setHeader('Set-Cookie', [...quemar, cookieSesion(sesion.token)]);
    res.redirect(APP_URL);
  } catch (e) {
    console.error('Auth error:', paso, e.code || (e.message === 'patreon_campaign_not_configured' ? e.message : 'sin_codigo'));
    res.redirect(urlError);
  }
}
