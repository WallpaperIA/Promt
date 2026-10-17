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

Las pruebas de fotos ejecutan el código real del HTML con respuestas lentas:
comprueban que la portada muestre la primera foto antes de terminar las ocho
consultas, que las tres vistas reutilicen consultas y firmas, y que abrir
una escena tenga prioridad en la cola común de cuatro pedidos. También cubren
la caducidad de cinco minutos, el descarte al cambiar de cuenta y que repintar
no mueva las tarjetas que ya están ordenadas.

La matriz de lectura cubre además la caché: sólo las fotos Casual/Editorial
**publicadas** pueden tener una respuesta pública. Los borradores, las fotos
protegidas, los rechazos y los errores conservan `private, no-store`.

También se comprueba el cambio de permisos con el mismo handler caliente:
despublicar, reclasificar y publicar deben tener efecto en el siguiente
pedido, tanto de una escena como del paquete de todas.

## Prueba de interfaz en una vista previa

`/scripts/qa-navegador.html` carga el código público actual dentro de un
iframe de 320, 390, 768 o 1280 px. Permite simular Visitante, Gratis, Premium,
Full y un Full guardado sin sesión. Los cuerpos son marcadores y las fotos
son el favicon: no descarga prompts ni fotos de la base.

La API simulada y el almacenamiento de cada escenario existen sólo en
memoria dentro del iframe. No leen ni escriben localStorage real, no entran
a Patreon, no aceptan acuerdos y no llaman a las API de producción. Esta
vista sirve para probar controles y diseño; los permisos reales se prueban
por separado con los handlers de producción de la suite pública. Pages
publica con lista explícita y no incorpora esta herramienta al sitio.

## La verificación completa sigue siendo obligatoria

`npm run verify` ejecuta primero todas las pruebas públicas y después las
verificaciones privadas de catálogo, respaldo y salud de prompts. No se
omite ni sustituye ninguna comprobación anterior.

Este comando necesita los archivos ignorados por git `data/prompts.js` y
`build/prompts.seed.json`. No se deben agregar al repositorio, a Actions ni
al artefacto de Pages. Un resultado verde en Actions no demuestra el
round-trip del catálogo privado: esa parte se ejecuta en el entorno del
dueño antes de confirmar cambios de prompts, acceso o validaciones.
