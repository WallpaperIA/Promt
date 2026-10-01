# Wallpaperia — guía del proyecto

Generador de prompts para IA de imágenes. Catálogo de ~199 categorías con
acceso por niveles de suscripción de Patreon.

Este archivo es para quien retome el proyecto. Lee primero la sección de
**reglas que no hay que romper**: varias existen porque ya fallaron antes.

---

## Arquitectura

```
GitHub Pages            Vercel (serverless)         Supabase
─────────────           ───────────────────         ────────
index.html         →    /api/prompt            →    prompt_bodies
data/catalog.js         /api/catalog                categories
(metadata, 60 KB)       /api/auth/*                 users, sessions
                        /api/admin/categories       free_usage
                        /api/webhooks/patreon
```

- **Una sola página.** `index.html`, ~4800 líneas, HTML/CSS/JS sin frameworks
  ni build step. Se edita directo. Cómo está armada la pantalla, en
  **La página**, más abajo.
- **El catálogo se parte en dos:** la metadata (id, nombre, tier, variantes)
  es pública y estática; los **cuerpos de los prompts viven en Supabase** y se
  sirven según el tier. Son 60 KB públicos contra 1,2 MB privados.
- **El servidor decide el acceso.** El navegador sólo dibuja candados.

## Reglas que no hay que romper

1. **Los prompts no vuelven a git.** `data/prompts.js` está en `.gitignore`.
   El repositorio es público y su historial ya se purgó una vez por esto.
   Si hace falta un respaldo, va fuera del repo.

2. **El workflow de Pages publica archivos uno por uno.** Nunca `cp -r data`:
   eso subiría `prompts.js`. Hay un paso que falla el deploy si se cuela.

3. **RLS activo y sin políticas** en todas las tablas. Sólo `service_role`
   entra. Si se desactiva, la clave pública de Supabase alcanza para leer
   todos los prompts.

4. **El cliente nunca declara su tier.** Manda un token de sesión; el permiso
   sale de la fila del usuario. Cualquier endpoint nuevo tiene que resolver
   el tier del lado del servidor, nunca leerlo del pedido. Se hace con
   `resolveTier()` de `api/_sesion.js`: dos copias de esa lógica se
   desincronizan y una de las dos termina dando de más.

5. **`npm run verify` tiene que pasar** antes de cualquier commit que toque
   prompts, acceso o validaciones.

## Los centinelas

Los prompts guardados no tienen nombres: tienen marcadores que el **navegador**
reemplaza al renderizar. Así los nombres de personajes nunca salen del equipo
del usuario.

| Marcador | Qué se reemplaza |
|---|---|
| `__N__` | el nombre, en variantes de una persona |
| `__N1__` `__N2__` `__N3__` | nombres en dúo y trío |
| `__N_HAIR__` `__N_FEATURES__` | datos del personaje (también `__N1_HAIR__`, etc.) |

Seis variantes por categoría: `prompt`, `prompt2`, `duoPrompt`, `duoPrompt2`,
`trioPrompt`, `trioPrompt2`. Las `2` son la versión v1.2 con más detalle de piel.

## Niveles de acceso

| Tier | Qué ve |
|---|---|
| `free` | **5 escenas fijas**, las de `GRATIS` en `api/_access.js` |
| `premium` | todo salvo xxx |
| `full` | todo, más los temas VIP |

Sin rotación ni cupo semanal: se sacaron en septiembre de 2026. `GRATIS`
vive en **un solo lugar**, `api/_access.js`; `/api/catalog` se la manda a la
página, que la usa sólo para dibujar candados. Cambiar las gratis es cambiar
ese array y desplegar Vercel.

`scripts/verify-access.mjs` lee `canAccessCat` de `index.html` —no una
copia— y la compara con `canAccess` del servidor en todas las categorías y
tiers. También falla si un id de `GRATIS` no existe, no está listo o es xxx.

Los umbrales de aporte están en `api/_patreon.js` y se comparan con **mayor o
igual**, nunca por igualdad: $10+ es `full`, $4+ es `premium`
(bajó de $7 el 28/09/2026; el precio de Patreon y este umbral van juntos). Antes era un
mapa exacto y quien aportaba $8 o $20 quedaba como `free`.

`is_admin` en la tabla `users` da acceso total y lo respetan los tres caminos
(revalidación, webhook y endpoint de prompts). Es para el dueño del proyecto.

## Flujo de publicación de categorías

```
borrador ──verificaciones OK + "ya la probé"──> prueba ──publicar──> publicada
```

Se maneja desde el **panel de administración** dentro de la app (botón Panel
dentro de ⚙ Ajustes, sólo visible con `is_admin`). Sin publicar, una categoría devuelve 404 para
todos salvo el admin.

Editar **invalida la prueba anterior**: lo aprobado ya no es lo que hay.

El botón **Respaldo** del panel baja, con el formato de `data/prompts.js`, las
categorías que existen sólo en Supabase. El panel escribe únicamente en la
base: sin esa copia, lo creado desde el navegador no está en ninguna máquina
ni en git. Pegarlo en `prompts.js` cierra además las dos trampas del sello y
del seed. `verify-respaldo.mjs` comprueba que el texto generado vuelva byte a
byte, con acentos graves y `${...}` incluidos. **Ese archivo lleva prompts: no
va a git.**

**Ocultar** una escena (botón del panel de la escena, o de la fila abierta en
el celular) sólo la oculta, en ese navegador y nada más; vuelve desde
⚙ Ajustes → **Ocultas**. En el código sigue llamándose papelera (`KEY_TRASH`,
`#trash-drawer`). El borrado real es el botón **Eliminar para siempre** que
aparece en Ocultas siendo admin: borra de Supabase y deja el id en `deleted_categories`. Esa lápida no
es opcional — sin ella las 199 originales seguirían en el `catalog.js` que ya
bajó cada visitante, y el próximo `npm run seed` las resucitaría desde
`data/prompts.js`.

### Qué hace a un prompt bueno

Dos criterios del dueño, y el catálogo se mide contra ellos:

1. **La persona por encima del fondo.** La foto es de ella; el lugar existe
   para que resalte. Hoy el catálogo va 1,96:1 a favor de la persona.
2. **La pose tiene que ser concreta**: qué hace el cuerpo, dónde están los
   brazos y las manos, hacia dónde mira. "Relaxed pose" o "natural posture" no
   dicen nada y el generador inventa una distinta en cada tirada.

Están en `docs/instrucciones-generador.md`, que es de donde salen todos los
prompts nuevos: ahí es donde conviene corregir el criterio, no prompt por
prompt.

**El chat generador no elige el tier**: describe la foto como fotografía y
el tier se elige en el panel, que arranca sin elegir y no deja guardar ni un
borrador sin él (el servidor también lo rechaza). Con "xxx = explícito" en
las instrucciones, el chat daba por hecho que se le pedía contenido
explícito y rechazaba fotos que eran sólo sugerentes. Por lo mismo, la v1.2
se le pide como "más detalle de la textura de la piel" con la misma ropa y
pose, no como "más piel".

Desde el 01/10/2026 los prompts nuevos van **por bloques con etiqueta**
(Pose, Expression, Outfit, Hair, Skin, Lighting, Background, Camera, Framing,
Micro-details, Avoid completely), una estructura que se tomó de estudiar
prompts ajenos que rendían mejor; los ejemplos del documento son propios.
Dos cosas de esa estructura las impone el sitio, no el gusto: la apertura
tiene que ser `<tipo de foto> of __N__` (el Estilo reemplaza lo que va antes
de " of") y la última línea, `16:9 4K ultra-sharp resolution.` (el Formato la
cambia). El documento también prohíbe copiar de la foto lo que identifica a
la modelo —cara, color de pelo, tatuajes, piercings— y cualquier nombre de
una persona real, incluso como "archetype" o "lookalike". `api/_validar.js` avisa —sin bloquear— cuando la pose es sólo una
frase vaga.

Las verificaciones están en `api/_validar.js` y comprueban **formato, no
calidad**, con la excepción de ese aviso de pose. El build genera `data/validar.js` desde ese mismo archivo quitándole
los `export`, así el navegador y el servidor usan la misma lógica sin
duplicarla. **No editar `data/validar.js`**: los cambios van en `api/_validar.js`.

## Imágenes de ejemplo

Venden mejor que cualquier texto: el que llega tiene que poder ver qué genera
el prompt antes de pagar. Sólo las categorías destacadas las tienen; el resto
no muestra nada.

- Los archivos viven en **Supabase Storage**, bucket `ejemplos`, que tiene que
  quedar **privado**. En el repositorio no pueden ir: es público, serían ~90 MB
  y ahí quedarían también los ejemplos de tier `xxx`.
- `category_examples` guarda sólo la referencia.
- `GET /api/ejemplos?id=<cat>` firma URLs temporales (30 min) **después** de
  comprobar el tier. Casual y editorial las ve cualquiera sin cuenta; hot y
  xxx exigen sesión y nivel — una URL abierta a una imagen explícita se indexa
  y después no se recoge.
- Si el tier no alcanza responde **403 con cuántas hay**, sin mandarlas: la
  categoría bloqueada muestra "Hay 2 imágenes · Suscribite para verlas", que
  es justo donde conviene invitar.
- `/api/catalog` devuelve `conEjemplos` con los ids que tienen alguna, para no
  preguntar de a una por las 199.
- Se suben desde **⚙ Panel → Ejemplos** de cada categoría. Van en base64
  dentro del JSON, con tope de 3 MB: Vercel corta el cuerpo cerca de 4,5 y
  base64 agranda un tercio. El nombre del archivo lo pone el servidor — si
  viniera del cliente, un `../` escribiría fuera de la carpeta.

## Los modificadores

Cinco listas que se aplican encima de cualquier prompt, en
`data/modificadores.js` — versionado, porque no contienen ningún prompt y ya
se publican tal cual dentro de `catalog.js`:

| Lista | Qué hace |
|---|---|
| `STYLES` | reemplazan la apertura (`prefix`) |
| `OUTFITS` | agregan una nota de vestuario al final (`instruction`) |
| `HAIRSTYLES` | agregan una nota de peinado al final (`instruction`); el color lo sigue poniendo el personaje |
| `FORMATS` | cambian la línea de resolución (`suffix`) |
| `DETAILS` | suman detalles al final; el campo `group` arma las secciones solo |

Agregar una opción es agregar un objeto a la lista y correr `build:catalog`.
`STYLES` y `OUTFITS` tienen `tier`; `HAIRSTYLES`, `FORMATS` y `DETAILS` son
para todos (los peinados llevan `tier:'free'` por si algún día se cierra
alguno). En la página se llaman `PEINADOS`, un alias que queda vacío si el
navegador tiene en caché un `catalog.js` anterior: el botón no aparece y nada
se rompe.

En `DETAILS`, el campo `excl` agrupa las que se contradicen: dentro de `fondo`,
`luz`, `lente` o `encuadre` se elige una y se desmarca la anterior. Sin eso el
prompt salía con dos instrucciones opuestas. Y no llevan icono: la interfaz usa
el sprite SVG.

Vivían al final de `data/prompts.js`, que está gitignoreado: agregar una
prenda obligaba a editar a mano 1,19 MB. `build-catalog` lee cada archivo en
**su propio contexto**, así que las copias viejas que hayan quedado en
`prompts.js` se ignoran en vez de chocar por declarar dos veces el mismo
`const`.

## Comandos

```bash
npm run build:catalog    # data/prompts.js → data/catalog.js + build/prompts.seed.json
npm run verify           # 58 comprobaciones — correr siempre antes de commitear
npm run seed             # carga los prompts a Supabase (necesita las env vars)
node scripts/og.mjs      # rehace assets/og.png, la vista previa al compartir

node scripts/dev-server.mjs --tier full --admin   # servidor local
#   --ejemplos <id>,<id>   carga imágenes de relleno para probar la galería
```

El servidor de desarrollo simula la API completa sin Supabase. `--tier` cambia
el nivel simulado; `--admin` habilita el panel. Acepta `?__autoopen=<id>` para
capturas automatizadas.

## Verificaciones

| Script | Qué comprueba |
|---|---|
| `verify-catalog.mjs` | los 1188 prompts renderizan idénticos tras el round-trip |
| `verify-access.mjs` | página y servidor deciden igual el acceso; la lista GRATIS es válida |
| `verify-patreon.mjs` | umbrales de tier y firma del webhook |
| `verify-respaldo.mjs` | el respaldo del panel vuelve idéntico tras pegarlo |
| `verify-prompts.mjs` | salud del catálogo: no aparecen defectos nuevos |
| `verify-validar.mjs` | las validaciones del panel |

Prueban con nombres que incluyen acentos, apóstrofes y un `$1` — ese último
rompe un `String.replace` mal escrito, y es un caso real que se encontró así.

## Deuda del catálogo

Los prompts se guardan **sueltos**: cada variante viaja sola al navegador, así
que cada una tiene que describir su escena entera. Una frase como *"same scene
and pose as above"* apunta a la nada.

Eso se coló en 490 cuerpos, y en **34 categorías** dejó la v1.2 en un texto
genérico **idéntico**, sin escena ni vestuario: elegir cualquiera de esas 34
devuelve el mismo prompt.

- `api/_validar.js` ahora **rechaza** esas frases, así que no puede entrar una
  nueva por el panel.
- `verify-prompts.mjs` mide el catálogo entero contra
  `scripts/prompts-baseline.json`. No falla por lo ya conocido —sería bloquear
  todos los commits— pero **sí por cualquier defecto nuevo**. A medida que se
  arreglan, `--actualizar` achica la línea base.
- `node scripts/rehacer-v12.mjs --salida pedido-v12.txt` arma el pedido para el chat
  generador: por cada una de las 34, su prompt v1 con la escena y qué devolver.
  Deja además `respuestas-v12.txt`, donde se pega lo que devuelve el chat.
  `node scripts/aplicar-v12.mjs --aplicar` lo revisa y lo escribe en
  `data/prompts.js`. **Los dos archivos llevan prompts: están en `.gitignore`.**
- **No se arreglan desde el panel.** El panel escribe en Supabase y el próximo
  `npm run seed` sube todo desde `data/prompts.js`, pisando lo editado sin
  avisar. Vale para cualquier categoría que esté en el archivo: se corrige
  en la fuente.

### Mejoras mecánicas

`node scripts/mejorar-prompts.mjs` corrige sobre `data/prompts.js` lo que está
mal de forma verificable, sin reescribir ninguna escena. Por defecto sólo
informa; escribe con `--aplicar` y deja copia del archivo anterior.

| Qué | Por qué |
|---|---|
| `Negative prompt:` → `Avoid completely:` | En el chat no hay campo negativo: es texto común, y termina nombrando lo que se quiere evitar |
| `subjects` → `she` | Coletilla copiada sin adaptar. Sólo en variantes de UNA persona: en dúo y trío el plural es correcto |
| coletilla de recorte cerrado | Se quita cuando la escena pide cuerpo entero. Pedían las dos cosas y la IA elegía al azar |

El script trabaja **variante por variante**, sacando la aridad de los
parámetros de cada función. Un reemplazo a ciegas sobre el archivo rompería
los dúos y los tríos, donde `subjects` está bien.

Después: `npm run build:catalog && npm run verify && npm run seed`.

## Trampas conocidas

- **`set -o pipefail` con `grep -q`**: el corte temprano manda SIGPIPE y la
  tubería devuelve 141, que se lee como "no encontrado". Usar `grep -c`.
  Esto hizo que una verificación diera limpio siempre.
- **Editar en el panel una categoría de `data/prompts.js` dura hasta el
  próximo seed**, que la pisa con la del archivo. El panel sirve para las
  que viven sólo en Supabase; las del archivo se corrigen en el archivo.
- **`>` en la PowerShell de Windows rompe los acentos**: decodifica la
  salida de node con la página de códigos de la consola. Los scripts que
  generan archivos aceptan `--salida <archivo>` y escriben UTF-8 ellos.
- **Git en Windows** convierte a CRLF al hacer checkout; los scripts escriben
  LF. Hay un `.gitattributes` que fuerza LF. Sin él, cada build dejaba
  `catalog.js` marcado como modificado y bloqueaba los cambios de rama.
- **Al cargar no se abre ninguna categoría.** Cuando había cupo semanal,
  abrir sola la primera le gastaba al visitante 1 de sus 5 prompts sin que
  eligiera nada. El cupo ya no existe, pero la regla sigue: lo primero que se
  ve tiene que ser algo elegido, no una categoría de prueba. En escritorio el
  panel vacío muestra la vitrina de categorías con fotos.
- **Los planes viven en una ventana** (`#planes`), no en la portada. Cualquier
  elemento con `data-abrir-planes` la abre, incluido el candado de una
  categoría bloqueada.
- **En escritorio el cuerpo de la sección se MUEVE** al panel de detalle, no se
  copia. Hay que devolverlo antes de reconstruir el accordion.
- **Las capturas headless** no pueden usar `scrollIntoView` con scroll suave:
  no completa. Filtrar con el buscador para llevar el elemento arriba.
- **Los derivados del acento se declaran en `body`, no en `:root`.** Una
  variable que usa `var()` se resuelve donde se declara: en `:root` quedaba
  fija con el ámbar y los temas premium y VIP, que cambian `--accent-h` en
  `body`, se veían todos naranjas. Pasó hasta septiembre de 2026. El selector
  de color también escribe en `body` y se guarda en `wp_accent_v1`.
- **`.sec-wrap` no tiene tope de alto.** Tenía `max-height:2400px` con
  `overflow:hidden`, puesto para animar el Ocultar, y cortaba la escena
  abierta: en el celular, con Prenda desplegada, las prendas de abajo
  quedaban tapadas. La animación fija el alto real en línea antes de cerrar.
- **"Un nombre en todas" sólo incluye las escenas ya abiertas** en ese
  navegador: los prompts se bajan de a uno al abrir cada escena. Pendiente.
- **El Formato cambia la línea `16:9 4K ultra-sharp resolution.`** del
  prompt. Hasta el 01/10/2026, si el prompt no la tenía, elegir otro formato
  no hacía nada; pasaba en varias escenas, entre ellas dos de las gratis.
  Ahora se agrega al final. Hay dos copias de esa función
  (`applyFormatInstruction` y `_gApplyFormat`): cambiar una es cambiar las dos.
- **El texto que se copia sale de un solo lugar**: `textoFinal()` dentro del
  cuerpo de cada escena. La vista previa lo usa también, así que muestra
  exactamente lo que se va a copiar. Antes había seis copias de esa lógica,
  una por botón.

## La página

- **Barra de arriba** (`#toolbar`): marca, buscador y cuenta. En el celular
  son dos filas y sólo queda pegada la del buscador: la barra tiene
  `top` negativo del alto de la primera fila (`--fila1`). Lo que se lleva
  arriba con scroll tiene que descontar `altoPegado()`, no el alto entero.
- **Portada** (`#lp-section`): texto y un mosaico con hasta 5 fotos de
  ejemplo. Si no hay fotos la columna se va (`.sin-fotos`). Se puede ocultar
  y se recuerda en `wp_lp_collapsed_v1`.
- **Generador**: desde 1100px, lista a la izquierda y panel a la derecha,
  cada uno del alto de la pantalla y con su propio scroll. Por debajo, el
  accordion de siempre.
- **Cuerpo de una escena**: dos columnas (foto y texto / controles) cuando el
  panel mide 760px o más, con una *container query*: depende del lugar que le
  toca, no del ancho de la ventana. En una columna, `.det-media` y `.det-ctl`
  se disuelven con `display:contents` y el orden lo da `order`, para que el
  nombre y Copiar queden antes que el texto del prompt.
- **Para quién** (Solo / Dúo / Trío) va separado de **Ajustar el prompt**
  (Estilo, Prenda, Formato, Extras, Editar). Abrir un ajuste ya no esconde el
  campo del nombre, y cada botón dice qué hay elegido.
- **Ajustes** (el engranaje) es una ventanita encima de la página: color,
  orden, vista compacta, Ocultas, "Un nombre en todas", el tema VIP y el
  Panel del admin.
- **Aviso de mayoría de edad** (`#edad`): tapa todo en la primera visita y
  deja el resto `inert` hasta que se confirma. Se recuerda en `wp_edad_v1`,
  y un script en el `<head>` lo esconde antes de pintar para que no
  parpadee en cada visita. Enlaza a `terminos.html` y `privacidad.html`,
  que el workflow de Pages publica sueltas junto con `assets/legal.css`.
- **Métricas**: Umami, sin cookies. Se activa poniendo el id en `UMAMI_ID`
  de `index.html`; vacío no carga nada. Todo pasa por `medir()`, que nunca
  tiene que recibir nombres de personajes ni texto de un prompt. Eventos:
  `abrir-escena`, `copiar`, `ver-planes`, `ir-a-patreon`, `entrar`,
  `edad-confirmada`. Si se agrega algo que se guarde o se mida, hay que
  contarlo en `privacidad.html`.

## Estilo

- **Comentarios en castellano**, explicando *por qué*, no *qué*. Los que hay
  documentan decisiones y bugs pasados: conservarlos.
- **Nada de emojis en la interfaz.** Hay un sprite de 34 iconos SVG que heredan
  `currentColor` y siguen los cuatro temas. Los emojis traían sus propios
  colores fijos y ensuciaban la pantalla.
- **`cleanName()`** quita los emojis de los nombres de categoría al mostrarlos.
  El dato queda intacto; es sólo presentación.
- **Escapar siempre** lo que va a `innerHTML` con `_esc()`.
- Los cambios se verifican **en navegador**, no sólo compilando. Hay
  herramientas para eso en `scripts/`.

## Pendientes conocidos

Al día del 27/09/2026. Hecho y desplegado desde el 18/09: portada rediseñada
(fotos arriba, marca única Wallpaperia, planes en ventana, capa visual
futurista, "Cómo funciona"), acceso simplificado a 5 gratis fijas sin
rotación ni cupo, 5 imágenes de ejemplo cargadas, post gratis de Patreon,
permisos explícitos de la Data API para el cambio de Supabase del 30/10, y
los scripts `post-gratis`, `rehacer-v12` y `aplicar-v12`.

El 27/09 se rediseñó la pantalla entera (ver **La página**): ancho completo,
barra fija con buscador, portada con mosaico de fotos, lista y panel del alto
de la pantalla, vista previa igual a lo que se copia, temas que ahora sí
cambian de color, avisos sin emoji y la papelera fuera de cada fila.

**Para retomar, en orden de valor:**

1. **Las 34 categorías con la v1.2 genérica** (4 editorial, 15 hot, 15 xxx).
   El circuito está armado y probado: `rehacer-v12 --salida pedido-v12.txt`
   → chat generador → `respuestas-v12.txt` → `aplicar-v12 --aplicar` →
   build, verify, `verify-prompts --actualizar`, seed. La de
   `beach-wet-dress` ya tiene respuesta buena y sin aplicar.
2. **Más imágenes de ejemplo.** Hay 5, las de las gratis. Cada categoría con
   foto aparece en la portada y en la vitrina (sólo casual y editorial).
3. **Respaldar las 16 del panel.** ⚙ Panel → Respaldo, guardarlo fuera del
   repo. Hoy existen en un solo lugar.
4. **Las 8 categorías con pose vaga**, que el panel ya marca con un aviso.
5. `users` y `sessions` no se crean en `supabase/schema.sql`.

**Sin resolver, de siempre:**

- El token de sesión vive en `localStorage`, al alcance de cualquier script
  de la página: un XSS lo robaría. Por eso escapar con `_esc()` no es
  opcional. (Hasta el 29/09/2026 además volvía de Patreon en `?session=` y
  quedaba en los registros del CDN; ahora vuelve en `#session=`, que no se
  manda al servidor.)
- Los temas se deciden en el cliente. Es cosmético y se corrige solo al
  recargar; no desbloquea contenido.
- Hay 16 categorías publicadas que viven sólo en Supabase y llegan por el
  delta. Para que pasen al archivo estático: **⚙ Panel → Respaldo**, pegar en
  `data/prompts.js`, y recién entonces `npm run build:catalog -- --sello-nuevo`.
  Sin copiarlas primero, adelantar el sello las borra del sitio.

Más detalle operativo en `DEPLOY.md`.
