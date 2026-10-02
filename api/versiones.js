import { createClient } from '@supabase/supabase-js';
import { crearHandlerVersiones } from './_versiones.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
export default crearHandlerVersiones(supabase);
