-- Ejecutar sólo DESPUÉS de publicar la API que usa cookies y hashes.
-- Las sesiones nuevas ya son SHA-256; se conservan aunque alguien haya
-- vuelto a entrar durante el despliegue. No borra cuentas ni versiones.
delete from public.sessions where token !~ '^[a-f0-9]{64}$';
