# Verificaciones sin fuente privada

`npm run verify:public` ejecuta doce suites sin credenciales, conexión a
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
comprueban que la portada muestre la primera foto sin esperar al resto,
que cinco fotos válidas usen sólo cinco consultas y que las fallas permitan
probar hasta ocho candidatos. También verifican que las tres vistas
reutilicen consultas y firmas, y que abrir
una escena tenga prioridad en la cola común de cuatro pedidos. También cubren
la caducidad de cinco minutos, el descarte al cambiar de cuenta y que repintar
no mueva las tarjetas que ya están ordenadas.

La prueba de rendimiento de interfaz conserva los resultados de búsqueda
con tildes, equivalencias y cambios de metadata. Comprueba las pulsaciones
agrupadas, la limpieza inmediata, los filtros, las sugerencias y la carrera
entre una foto que llega y una búsqueda pendiente. También ejecuta la
reconstrucción del catálogo y sus cabeceras: las preferencias se leen una
vez por pasada, el DOM recibe un fragmento, y los clicks posteriores leen
las favoritas actuales. Los cinco selectores de ajustes se construyen al
abrirlos por primera vez: se comprueba que no haya tarjetas al abrir la
escena, que sigan disponibles las 119 opciones, que no se dupliquen al
reabrir y que se conserven las elecciones, los candados y las restricciones
de prendas con ilustración incluso si la prenda todavía no se había abierto.
El orden por foto evalúa cada permiso una sola vez por dibujo, sin cambiar
las reglas de acceso.

Las 34 prendas retiradas a pedido se comprueban en el selector tanto con los
modificadores actuales como con una copia anterior del catálogo. Una selección
guardada de una prenda retirada vuelve a Original. Quedan 35 prendas más
Original; el catálogo de escenas y su sello no se regeneran.

Para comparar la búsqueda con un HTML anterior:
`node scripts/verify-rendimiento-ui.mjs --comparar /ruta/anterior/index.html`.
Usa 335 filas sintéticas derivadas de metadata pública y 200 consultas;
exige resultados idénticos e informa las normalizaciones y la mediana de
cinco pasadas en Node. No mide la carga de la app, la red ni un dispositivo.

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
