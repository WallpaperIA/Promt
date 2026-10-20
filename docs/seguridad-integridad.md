# Integridad de guardados

La revisión adicional detectó dos fallos reproducibles con datos sintéticos:
un error de inserción después del borrado dejaba una escena sin sus textos,
y veinte creaciones simultáneas permitían pasar de 99 a 119 versiones.

`guardar_categoria_atomica` guarda metadata y variantes en una transacción.
Un fallo conserva todo lo anterior. Sólo `service_role` puede ejecutarla;
no se habilitan políticas ni acceso directo desde el navegador.

El trigger `prompt_versions_limite_por_cuenta` serializa inserciones por
dueño y rechaza la versión 101. La API mantiene el conteo previo como
optimización y traduce el rechazo concurrente al mismo `409 version_limit`.

Antes de publicar la API, aplicar la migración
`supabase/migrations/20261020033349_seguridad_integridad_datos.sql`.
Es compatible con la API anterior y no modifica textos, usuarios ni sesiones
existentes. Sin la función instalada, el nuevo guardado devuelve 503 y evita
volver al borrado inseguro.

`verify-integridad.mjs` prueba los handlers sin credenciales. CI levanta además
Postgres 17 desechable y ejecuta `verify-integridad-db.mjs`: provoca un fallo
después del DELETE, comprueba el rollback de metadata y textos, verifica
permisos y lanza veinte conexiones independientes contra el límite de 100.
Las pruebas de `supabase/tests/` son exclusivamente para esa base desechable.

Este cambio es independiente del PR #48 y no edita `index.html`.
