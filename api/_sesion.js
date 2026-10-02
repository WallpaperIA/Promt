/**
 * Quién es quien pide, resuelto del lado del servidor.
 *
 * El cliente manda un token de sesión y nada más: el tier y la marca de
 * administración salen de la base. Si un endpoint nuevo necesita saber el
 * nivel de acceso, importa de acá en vez de rehacerlo — dos copias de esta
 * lógica se desincronizan y una de las dos termina dando de más.
 */

/** Token del header Authorization: Bearer ... */
export function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

/**
 * @returns {Promise<{tier:'free'|'premium'|'full', token:string|null, admin:boolean, userId:string|null}>}
 *
 * Devuelve 'free' ante cualquier duda: sin token, con token vencido o
 * inexistente. Nunca lee el tier de lo que manda el cliente.
 */
export async function resolveTier(supabase, token) {
  const anonimo = { tier: 'free', token: null, admin: false, userId: null };
  if (!token) return anonimo;
  const { data: session, error } = await supabase
    .from('sessions')
    .select('expires_at, users(id, tier, is_admin)')
    .eq('token', token)
    .single();
  if (error || !session) return anonimo;
  const vencimiento = new Date(session.expires_at).getTime();
  if (!Number.isFinite(vencimiento) || vencimiento <= Date.now()) return anonimo;
  // Las versiones privadas necesitan el dueño resuelto en esta misma consulta:
  // recibirlo del navegador permitiría editar la biblioteca de otra cuenta.
  const userId = session.users?.id ?? null;
  // La marca de administración manda sobre el tier: si algo dejara esa fila
  // en 'free' por error, el dueño no perdería acceso a su propio catálogo.
  if (session.users?.is_admin) return { tier: 'full', token, admin: true, userId };
  const tier = session.users?.tier;
  return { tier: ['premium', 'full'].includes(tier) ? tier : 'free', token, admin: false, userId };
}
