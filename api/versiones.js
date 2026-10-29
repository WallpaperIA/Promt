import { createClient } from '@supabase/supabase-js';
import { crearHandlerVersiones } from './_versiones.js';
import { crearHandlerAjustes } from './_ajustes.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const versiones = crearHandlerVersiones(supabase);
const ajustes = crearHandlerAjustes(supabase);
export default function handler(req, res) {
  return (req.query?.ajustes === '1' ? ajustes : versiones)(req, res);
}
