import { createClient } from '@supabase/supabase-js';
import { crearHandlerVersiones } from './_versiones.js';
import { crearHandlerAjustes } from './_ajustes.js';
import { limitar } from './_limite.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const versiones = crearHandlerVersiones(supabase);
const ajustes = crearHandlerAjustes(supabase);
export default function handler(req, res) {
  const deAjustes = req.query?.ajustes === '1';
  // Los ajustes se guardan como mucho cada 1,5 s mientras hay cambios (~40
  // por minuto escribiendo sin parar); un 429 los deja pendientes en el
  // dispositivo y se reintentan solos. Cada uno lleva su propia cuenta.
  if (req.method !== 'OPTIONS' && limitar(req, res, deAjustes ? 'ajustes' : 'versiones', 120)) return;
  return (deAjustes ? ajustes : versiones)(req, res);
}
