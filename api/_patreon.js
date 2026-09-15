/**
 * Todo lo que toca la API de Patreon, en un solo lugar.
 *
 * Lo usan el callback del login, la revalidación periódica y el webhook, para
 * que los tres decidan el tier con la MISMA regla. Antes la lógica vivía sólo
 * en callback.js, así que el tier se calculaba una vez al entrar y no volvía
 * a revisarse nunca.
 */

/**
 * Umbrales en centavos. Se compara con >=, no por igualdad.
 *
 * Antes era un mapa exacto {700:'premium', 1000:'full'}: quien aportaba
 * cualquier otro monto —$8, $12, $20— no coincidía con ninguna clave y
 * quedaba como free. Es decir, los que más pagaban eran los que menos
 * recibían, y sin ningún aviso.
 */
const UMBRALES = [
  { cents: 1000, tier: 'full' },
  { cents: 700, tier: 'premium' },
];

/** Orden de los tiers, para poder comparar cuál es mayor. */
const RANGO = { free: 0, premium: 1, full: 2 };

export function tierDesdeCentavos(cents) {
  const n = Number(cents) || 0;
  for (const u of UMBRALES) if (n >= u.cents) return u.tier;
  return 'free';
}

/**
 * El tier que corresponde a un conjunto de membresías.
 * Se queda con la MÁS ALTA de las activas: alguien puede figurar en varias
 * campañas, y quedarse con la última que aparece sería arbitrario.
 */
export function tierDesdeMembresias(included) {
  let mejor = 'free';
  for (const item of included || []) {
    if (item.type !== 'member') continue;
    const a = item.attributes || {};
    if (a.patron_status !== 'active_patron') continue;
    const t = tierDesdeCentavos(a.currently_entitled_amount_cents);
    if (RANGO[t] > RANGO[mejor]) mejor = t;
  }
  return mejor;
}

const IDENTITY_URL =
  'https://www.patreon.com/api/oauth2/v2/identity' +
  '?fields%5Buser%5D=email,full_name' +
  '&include=memberships' +
  '&fields%5Bmember%5D=currently_entitled_amount_cents,patron_status';

/** Canjea el código de autorización por tokens. */
export async function canjearCodigo(code, redirectUri) {
  const r = await fetch('https://www.patreon.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: process.env.PATREON_CLIENT_ID,
      client_secret: process.env.PATREON_CLIENT_SECRET,
      redirect_uri: redirectUri,
    }),
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('Patreon no devolvió access_token');
  return data;
}

/** Renueva el access_token vencido con el refresh_token. */
export async function renovarToken(refreshToken) {
  const r = await fetch('https://www.patreon.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.PATREON_CLIENT_ID,
      client_secret: process.env.PATREON_CLIENT_SECRET,
    }),
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('Patreon no pudo renovar el token');
  return data;
}

/** Identidad + tier vigente de quien posee ese access_token. */
export async function traerIdentidad(accessToken) {
  const r = await fetch(IDENTITY_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const err = new Error(`identity ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const d = await r.json();
  const patreonId = d.data?.id;
  if (!patreonId) throw new Error('Patreon no devolvió el id de usuario');
  return {
    patreonId,
    email: d.data?.attributes?.email || null,
    fullName: d.data?.attributes?.full_name || null,
    tier: tierDesdeMembresias(d.included),
  };
}

/** Campos de token listos para guardar, a partir de la respuesta de Patreon. */
export function camposDeToken(tokenData) {
  const segundos = Number(tokenData.expires_in) || 30 * 24 * 60 * 60;
  return {
    patreon_access_token: tokenData.access_token,
    // En una renovación Patreon puede no mandar uno nuevo: se conserva el anterior.
    ...(tokenData.refresh_token ? { patreon_refresh_token: tokenData.refresh_token } : {}),
    patreon_token_expires_at: new Date(Date.now() + segundos * 1000).toISOString(),
  };
}

/**
 * Relee el tier de un usuario contra Patreon, renovando el token si hace falta.
 * @returns {Promise<{tier:string, updates:object}>} updates va a la fila de users
 */
export async function revalidarTier(user) {
  let accessToken = user.patreon_access_token;
  let updates = {};

  if (!accessToken && !user.patreon_refresh_token) {
    throw new Error('sin tokens de Patreon guardados');
  }

  const vencido =
    !accessToken ||
    (user.patreon_token_expires_at && new Date(user.patreon_token_expires_at) <= new Date());

  if (vencido) {
    const nuevos = await renovarToken(user.patreon_refresh_token);
    updates = { ...camposDeToken(nuevos) };
    accessToken = nuevos.access_token;
  }

  let ident;
  try {
    ident = await traerIdentidad(accessToken);
  } catch (e) {
    // Un 401 con token supuestamente vigente significa que fue revocado:
    // se reintenta una vez renovando.
    if (e.status === 401 && user.patreon_refresh_token && !vencido) {
      const nuevos = await renovarToken(user.patreon_refresh_token);
      updates = { ...updates, ...camposDeToken(nuevos) };
      ident = await traerIdentidad(nuevos.access_token);
    } else {
      throw e;
    }
  }

  return {
    tier: ident.tier,
    updates: {
      ...updates,
      tier: ident.tier,
      // Sólo se pisan si Patreon los devolvió: si no, un login sin email
      // borraría el que ya teníamos.
      ...(ident.email ? { email: ident.email } : {}),
      ...(ident.fullName ? { full_name: ident.fullName } : {}),
      tier_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}
