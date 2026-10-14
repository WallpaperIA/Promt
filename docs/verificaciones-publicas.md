# Verificaciones sin fuente privada

`npm run verify:public` ejecuta once suites sin credenciales, conexión a
Supabase ni textos privados. Usa el catálogo público y datos sintéticos.

GitHub Actions ejecuta este comando en cada PR hacia `main` y cada push a
`main`, con permisos de sólo lectura. No publica el sitio ni combina PRs.

La suite comprueba los handlers reales de prompts y fotos para visitantes,
Gratis, Premium, Full y administración; las seis variantes, los borradores,
las sesiones vencidas o inválidas y los intentos de declarar permisos desde
el cliente. También incluye las pruebas existentes de subida de fotos,
versiones privadas, precios y firmas de Patreon, validaciones, miniaturas,
comparador y modificadores. El simulador de desarrollo se prueba con un
catálogo sintético y un seed vacío, para que Premium no abra fotos íntimas.

La matriz de lectura cubre además la caché: sólo las fotos Casual/Editorial
**publicadas** pueden tener una respuesta pública. Los borradores, las fotos
protegidas, los rechazos y los errores conservan `private, no-store`.

## La verificación completa sigue siendo obligatoria

`npm run verify` ejecuta primero todas las pruebas públicas y después las
verificaciones privadas de catálogo, respaldo y salud de prompts. No se
omite ni sustituye ninguna comprobación anterior.

Este comando necesita los archivos ignorados por git `data/prompts.js` y
`build/prompts.seed.json`. No se deben agregar al repositorio, a Actions ni
al artefacto de Pages. Un resultado verde en Actions no demuestra el
round-trip del catálogo privado: esa parte se ejecuta en el entorno del
dueño antes de confirmar cambios de prompts, acceso o validaciones.
