import { createClient } from '@supabase/supabase-js';
import { crearHandlerBiblioteca } from './_biblioteca.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
export default crearHandlerBiblioteca(supabase);
