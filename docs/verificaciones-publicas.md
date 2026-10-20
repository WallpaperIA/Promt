# Verificaciones sin fuente privada

`npm run verify:public` ejecuta dieciséis suites sin credenciales, conexión a
Supabase ni textos privados. Usa el catálogo público y datos sintéticos.
Necesita `npm install` (o `npm ci`) una vez, por esbuild.

GitHub Actions ejecuta `npm ci` y este comando en cada PR hacia `main` y cada
push a `main`, con permisos de sólo lectura. No publica el sitio ni combina PRs.

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
escena, que sigan disponibles las 141 opciones, que no se dupliquen al
reabrir y que se conserven las elecciones y los candados por plan.
Todos los estilos y prendas están disponibles en Casual, Editorial, Hot e
Íntimo. Cambiar de estilo conserva la prenda, incluso Sin Ropa, antes y
después de abrir su panel.
El orden por foto evalúa cada permiso una sola vez por dibujo, sin cambiar
las reglas de acceso.

Las 34 prendas retiradas a pedido se comprueban en el selector tanto con los
modificadores actuales como con una copia anterior del catálogo. Una selección
guardada de una prenda retirada vuelve a Original. El lote de referencias
añade 22 opciones Full: ocho referencias individuales, once cortes del
collage y tres ideas adicionales. Quedan 57 prendas más Original; el
catálogo de escenas y su sello no se regeneran.

El lote completo debe llegar al navegador desde el archivo público de
modificadores. Las notas describen tejidos y cortes sin exigir cobertura ni
añadir forros o paneles opacos; conservan identidad, proporciones, pose y
entorno. Se comprueba que no reaparezca la marca de bloqueo `revela`.
La dirección artística conserva adultos de 25 años o más con rasgos maduros.
La prueba ejecuta los handlers de
las 57 prendas, comprueba que cada selección aplica su nota sobre un texto
sintético con centinelas y verifica que una prenda nueva guardada se restaura.
Los candados se prueban intentando seleccionar todas las tarjetas bloqueadas.

Las prendas favoritas guardan sólo IDs públicos locales. Se prueban datos
malformados, almacenamiento lleno, IDs retirados, otra visita y cambios de
otra pestaña. Los handlers reales combinan favoritas, tipo, tela y búsqueda;
marcar un corazón no selecciona ropa ni vuelve a componer el prompt. Se
comprueban filtros combinados, estados vacíos, foco al quitar la última
favorita, limpieza de filtros y reapertura sin duplicar controles.
La clasificación vive en `data/prendas-filtros.js`, con sólo ID, tipo y telas.
Se comprueba su publicación individual y que no contenga notas de vestuario;
`data/modificadores.js`, el catálogo y su sello permanecen intactos.

El cambio de vestuario se prueba con fragmentos sintéticos: sustituye sólo
el bloque Outfit/Vestuario, también con etiquetas en línea, Markdown, CRLF
y varias personas. Conserva el resto byte a byte, resolución, nombres y
centinelas. Si no hay bloque o se perdería un nombre, conserva el texto y
añade una instrucción prioritaria. Reaplicar no acumula notas del catálogo;
una nota libre del usuario permanece. Copia individual y «Un nombre en todas»
usan la misma función. No se prueban resultados de generación en una IA.

Para comparar la búsqueda con un HTML anterior:
`node scripts/verify-rendimiento-ui.mjs --comparar /ruta/anterior/index.html`.
Usa 335 filas sintéticas derivadas de metadata pública y 200 consultas;
exige resultados idénticos e informa las normalizaciones y la mediana de
cinco pasadas en Node. No mide la carga de la app, la red ni un dispositivo.

La matriz de lectura cubre además la caché: sólo las fotos Casual/Editorial
**publicadas** pueden tener una respuesta pública. Los borradores, las fotos
protegidas, los rechazos y los errores conservan `private, no-store`. Cada
foto devuelve también su miniatura, firmada en el mismo pedido, o la original
si todavía no tiene; un rechazo no firma ninguna de las dos.

`verify-catalogo-api.mjs` ejecuta el handler real de `/api/catalog`: sin
sesión responde con caché pública (navegador y CDN de Vercel); con cualquier
token, válido o no, responde `private, no-store` y nunca incluye borradores
salvo para el admin. Los errores y los métodos no permitidos no se cachean,
el paginado conserva las variantes de más de mil filas y las consultas
independientes salen juntas. También comprueba que la página pida sin caché
del navegador cuando hay sesión.

`verify-ejemplos.mjs` cubre además las miniaturas: se suben con la foto o
después con el botón del panel, sólo WebP de hasta 200 KB, siempre en la
ruta de una fila de esa categoría, y se borran con la foto.

`verify-minificado.mjs` minifica `index.html` como lo hace Pages y comprueba
que los scripts compilen, que se conserven los nombres de primer nivel y
todos los ids, que `<pre>` y `<textarea>` no cambien y que el script del
aviso de edad siga antes del CSS.

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
