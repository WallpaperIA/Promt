import { crearHandlerVersiones } from './_versiones.js';
import { crearHandlerCombinaciones } from './_combinaciones.js';
import { applyCors } from './_cors.js';

// Compartir la ruta conserva el margen de funciones del plan de Vercel.
export function crearHandlerBiblioteca(supabase) {
  const versiones = crearHandlerVersiones(supabase), combinaciones = crearHandlerCombinaciones(supabase);
  return (req, res) => {
    if (req.query?.recurso === 'combinaciones') return combinaciones(req, res);
    if (req.query?.recurso != null) {
      applyCors(req, res, 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(400).json({ error: 'bad_request' });
    }
    return versiones(req, res);
  };
}
