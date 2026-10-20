/**
 * Autenticación de administración, en un solo lugar.
 *
 * La marca is_admin vive en la base y no se puede falsear desde el cliente:
 * lo único que éste manda es un token de sesión, y el permiso sale de la fila
 * del usuario.
 */

// El token se lee en un solo lugar: api/_sesion.js. Se re-exporta para no
// romper lo que ya lo importaba desde acá.
import { bearer, resolveTier } from './_sesion.js';
export { bearer };

/**
 * @returns {Promise<{id:string}|null>} el usuario admin, o null
 */
export async function usuarioAdmin(supabase, req) {
  const session = await resolveTier(supabase, bearer(req));
  return session.admin && session.userId != null ? { id: session.userId } : null;
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
