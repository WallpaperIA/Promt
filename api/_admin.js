/**
 * Autenticación de administración, en un solo lugar.
 *
 * La marca is_admin vive en la base y no se puede falsear desde el cliente:
 * lo único que éste manda es un token de sesión, y el permiso sale de la fila
 * del usuario.
 */

/** Token del header Authorization: Bearer ... */
export function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

/**
 * @returns {Promise<{id:string}|null>} el usuario admin, o null
 */
export async function usuarioAdmin(supabase, req) {
  const token = bearer(req);
  if (!token) return null;

  const { data: session, error } = await supabase
    .from('sessions')
    .select('expires_at, users(id, is_admin)')
    .eq('token', token)
    .single();

  if (error || !session) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  if (!session.users?.is_admin) return null;

  return { id: session.users.id };
}

/**
 * Corta con 401 si quien llama no es admin.
 * Se responde 401 y no 403 a propósito: no hace falta confirmarle a un
 * desconocido que el endpoint existe y que simplemente le falta permiso.
 */
export async function exigirAdmin(supabase, req, res) {
  const admin = await usuarioAdmin(supabase, req);
  if (!admin) {
    res.status(401).json({ error: 'no_autorizado' });
    return null;
  }
  return admin;
}
