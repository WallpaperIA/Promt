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
- **Dos orígenes.** GitHub Pages (`wallpaperia.github.io/Promt/`) es el
  catálogo para visitantes y nunca tiene sesión. La cuenta abre en
  `https://promt-iota.vercel.app/`, la misma página servida junto a la API.
  La sesión es una cookie `__Host-wp_session` HttpOnly/Secure/SameSite=Lax de
  30 días; la base guarda sólo su SHA-256. No se aceptan tokens en URL, JSON,
  Bearer ni localStorage. Desde Pages la cookie no viaja (es otro sitio): por
  eso "Entrar" lleva a Vercel, y si ya hay una sesión válida entra directo
  sin repetir Patreon. Detalle y orden de despliegue en `DEPLOY.md`.

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

## Comparar con el original

Editar y Mis versiones ofrecen un comparador de sólo lectura. La edición
local se compara con el original del modo y variante elegidos usando rótulos;
Mis versiones consulta el cuerpo canónico actual por `/api/prompt` sólo al
tocar Comparar. Si se retiró la escena o no alcanza el plan, avisa sin borrar
la copia. No se completan nombres ni se registran textos en métricas.

El diálogo conserva exactamente espacios, saltos y marcadores, resalta lo
quitado y agregado y no guarda ni restaura cambios. Se limpia al cerrar o
cambiar de sesión. Una diferencia demasiado larga usa bloques para evitar
trabajo cuadrático sin límite en el celular. `verify-comparador.mjs` reconstruye
ambos textos para comprobar que el algoritmo no pierde contenido.

## Los centinelas

Los prompts guardados no tienen nombres: tienen marcadores que el **navegador**
reemplaza al renderizar. Así los nombres de personajes nunca salen del equipo
del usuario.

| Marcador | Qué se reemplaza |
|---|---|
| `__N__` | el nombre, en variantes de una persona |
| `__N1__` `__N2__` `__N3__` | nombres en dúo y trío |
| `__N_HAIR__` `__N_FEATURES__` | datos del personaje (también `__N1_HAIR__`, etc.) |

Tres variantes en uso: `prompt`, `duoPrompt` y `trioPrompt` (Solo, Dúo, Trío).
Las `2` (`prompt2`, `duoPrompt2`, `trioPrompt2`) eran la v1.2 "+PIEL", con
más detalle de piel. **Desde el 04/10/2026 la página no las muestra y el panel
no las pide**: en 33 escenas devolvían el mismo texto genérico y concentraban
586 de los 588 defectos conocidos del catálogo. Siguen en `data/prompts.js` y
en la base por si se quiere volver; guardar una categoría desde el panel las
borra de Supabase, porque el servidor deja exactamente las variantes que recibe.

## Niveles de acceso

| Tier | Qué ve |
|---|---|
| `free` | **5 escenas fijas**, las de `GRATIS` en `api/_access.js` |
| `premium` | todo salvo xxx |
| `full` | todo, más los temas VIP |

El tier `xxx` se muestra como **Íntimo** desde el 03/10/2026: el filtro, la
etiqueta, los planes y los Términos. Por dentro sigue siendo `xxx` (base,
permisos, seed), así que el cambio fue sólo de texto. Las escenas son boudoir
y desnudo insinuado. El nombre visible describe ese alcance del catálogo;
el identificador interno `xxx` no impone condiciones de cobertura.

Sin rotación ni cupo semanal: se sacaron en septiembre de 2026. `GRATIS`
vive en **un solo lugar**, `api/_access.js`; `/api/catalog` se la manda a la
página, que la usa sólo para dibujar candados. Cambiar las gratis es cambiar
ese array y desplegar Vercel.

`scripts/verify-access.mjs` lee `canAccessCat` de `index.html` —no una
copia— y la compara con `canAccess` del servidor en todas las categorías y
tiers. También falla si un id de `GRATIS` no existe, no está listo o es xxx.

Los umbrales de aporte están en `api/_patreon.js` y se comparan con **mayor o
igual**, nunca por igualdad: $5+ es `full`, $2+ es `premium` (desde el
01/10/2026; antes $7/$10 y después $4/$10). El precio de Patreon y este
umbral van juntos: cambiar uno sin el otro deja como free a quien paga. Antes era un
mapa exacto y quien aportaba $8 o $20 quedaba como `free`.

`is_admin` en la tabla `users` da acceso total y lo respetan los tres caminos
(revalidación, webhook y endpoint de prompts). Es para el dueño del proyecto.

`PATREON_CAMPAIGN_ID` fija la campaña que puede conceder acceso. El scope
`identity.memberships` incluye otros creadores: nunca elegir el aporte mayor
sin filtrar `relationships.campaign.data.id`. Login, revalidación y webhook
guardan `patreon_campaign_id`; `resolveTier()` rechaza planes sin esa
procedencia. Admin es independiente.

**Dos plazos, no uno.** `verify` revalida contra Patreon al cargar la página
si pasaron 6 h (`FRESCURA_TIER_MS`); `resolveTier()` acepta lo comprobado
durante 72 h (`VALIDEZ_TIER_MS`). Con un solo plazo de 6 h, quien dejaba la
pestaña abierta pasaba a free a mitad de la visita con la insignia VIP a la
vista, y una caída de Patreon dejaba sin acceso a todos. "No es miembro"
baja en el acto; "no se pudo consultar" conserva lo comprobado hasta las
72 h. Las bajas llegan además por el webhook. Si la página recibe un 403
donde esperaba acceso, pregunta a `verify` una vez y reintenta.

## Flujo de publicación de categorías

```
borrador ──verificaciones OK + "ya la probé"──> prueba ──publicar──> publicada
```

Se maneja desde el **panel de administración** dentro de la app (botón Panel
dentro de ⚙ Ajustes, sólo visible con `is_admin`). Sin publicar, una categoría devuelve 404 para
todos salvo el admin.

Editar **invalida la prueba anterior**: lo aprobado ya no es lo que hay.

Guardar desde el panel pasa por `guardar_categoria_atomica`, una función de
Postgres (`supabase/migrations/`): la metadata y las variantes se guardan
juntas o no se guarda nada. Antes se borraban las variantes y después se
insertaban las nuevas, y un fallo entre medio dejaba una escena publicada
sin texto. Sin la función instalada el panel responde 503 y no vuelve al
camino viejo. Detalle en `docs/seguridad-integridad.md`.

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

**Dúo y Trío conservan la escena de Solo (20/10/2026).** Una persona mantiene
la pose principal; las otras tienen posturas complementarias con apoyo,
espacio y brazos y piernas propios. No alcanza con copiar la misma pose y
cambiar el marcador o el lado. Se conserva la acción, el vestuario, la luz y
la intención del encuadre; sólo se adapta su distribución para el grupo.
Una selfie tiene una cámara de captura, sostenida por una persona identificada;
los demás cuerpos ocupan su propio asiento o soporte. Cada variante es un
texto completo, sin referencias a Solo. La guía incluye comprobaciones de
anatomía, tamaño de muebles, perspectiva y foco; son criterios de redacción,
no nuevos bloqueos de contenido ni cambios de permisos.

Están en `docs/instrucciones-generador.md`, que es de donde salen todos los
prompts nuevos: ahí es donde conviene corregir el criterio, no prompt por
prompt.

**Fidelidad al tono y al vestuario (20/10/2026).** Los prompts nuevos no
agregan restricciones de tono (`non-explicit`, `tasteful`, `modest`) ni recursos
para ocultar el cuerpo: parches, forros impuestos, paneles, sombras, objetos o
cambios de pose. Se describe la prenda solicitada con su construcción real;
una tela gruesa o un forro que sea parte del diseño no es un filtro. Los
personajes siguen siendo adultos inequívocos de 25 años o más y se mantienen
las reglas de consentimiento e identidad. La instrucción completa y el
ejemplo para pegar están en `docs/instrucciones-generador.md`.

**El chat generador no elige el tier**: describe la escena solicitada con
fidelidad. El tier se elige en el panel, que arranca sin elegir y no deja
guardar ni un borrador sin él (el servidor también lo rechaza). Clasifica el
acceso al catálogo; no cambia el tono, la pose ni el vestuario del texto.

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
el prompt antes de pagar. Al 23/10/2026 las 335 escenas publicadas tienen al
menos una; una escena sin fotos simplemente no muestra nada.

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
  viniera del cliente, un `../` escribiría fuera de la carpeta. Desde el
  25/10/2026 los bytes tienen que ser de verdad JPEG, PNG o WebP y coincidir
  con el tipo declarado (`coincideConTipo()`): el tipo lo manda el navegador,
  y una sesión de admin robada podía subir un HTML rotulado como foto.
- Los IDs con tildes se conservan en `category_examples.cat_id`, pero su
  carpeta de Storage usa `utf8/<bytes en hexadecimal>`: Storage rechaza las
  tildes en una ruta. Los IDs ASCII conservan su carpeta anterior. Quitar
  verifica también la fila por `cat_id` y `ruta`, para que el prefijo no
  alcance para borrar un archivo ajeno. `verify-ejemplos.mjs` reproduce el
  rechazo original y comprueba la subida, el listado y el borrado seguros.
- **Un pedido para todas** (desde el 22/10/2026). `GET /api/ejemplos?todas=1`
  devuelve la primera foto (original y miniatura) de cada escena que quien
  pide puede ver: con eso se pintan las tarjetas de Explorar, las filas de
  Lista y la portada. Antes era un pedido por escena, de a cuatro y de 0,5 a
  1 s cada uno: más de 300 con Full para recorrer Explorar, y en Lista sólo
  tenían foto las cinco de la portada, porque nada pedía las demás. Usa la
  misma regla de permisos que el pedido de a una (`puedeVerFotos()`), y la
  galería sigue pidiendo todas las fotos de su escena.
  - Sin sesión es igual para todos y la guarda el CDN: 10 min, y vencida
    hasta 50 más mientras pide otra por detrás (`stale-while-revalidate`).
    Así el primer visitante después de un rato sin uso no espera a que
    arranque la función. Ese lote, sólo Casual/Editorial publicadas, se firma
    por 2 h (`VIGENCIA_LOTE_PUBLICO_SEG`): Storage repite una misma firma
    durante varios minutos y lo servido tiene que seguir valiendo mientras
    la página lo usa. Con sesión, todo sigue en 30 minutos. Esa rama no lee
    la sesión. En la cuenta la página pide con `cuenta=1` y recibe
    `private, no-store`, igual que el catálogo.
  - Si el servidor no lo conoce o falla, la página vuelve a pedir de a una
    (y recuerda el fallo cinco minutos). Una escena que no vino en el lote,
    por ejemplo una foto recién subida, también se pide aparte.
- Portada, Explorar y galería comparten consultas y firmas en memoria,
  durante cinco minutos y sólo en la sesión actual. Hay hasta cuatro pedidos
  simultáneos entre las tres vistas; abrir una galería tiene prioridad sobre
  las miniaturas pendientes. La primera foto de una galería carga de
  inmediato; las siguientes conservan carga diferida. La caché HTTP sigue
  las cabeceras del servidor: sólo Casual/Editorial publicadas son públicas.
  No se cambian el bucket privado, las firmas de 30 minutos ni los permisos.
- **Miniaturas** (desde el 17/10/2026). Las tarjetas de Explorar, las fotos
  chicas de la portada, la vitrina y el cuadrito de cada fila usan la misma
  foto a 640 px en WebP (~27 KB; las originales son JPEG de ~145 KB). Bajar
  seis pantallas de Explorar en el celular pasaba de 3 MB. Sólo la foto
  principal de la portada y la galería usan la original.
  - Viven junto a la original en el mismo bucket privado, con nombre
    derivado: `<ruta>.mini.webp` (`api/_miniaturas.js`). Sin columna ni
    migración: si no existe, se usa la grande.
  - `/api/ejemplos` devuelve `imagenes` y `miniaturas` en el mismo orden y en
    una sola firma, así las tres vistas siguen compartiendo un pedido.
  - Las genera **el navegador del admin** (canvas → WebP 0,8), no el
    servidor: Vercel no necesita una librería de imágenes. Al subir una foto
    va junto con ella; para las que ya estaban, **⚙ Panel → Miniaturas**
    recorre las escenas con fotos y rellena las que faltan (se puede correr
    de nuevo: salta las hechas). El servidor sólo acepta WebP de hasta
    200 KB y escribe en la ruta de una fila de esa categoría, nunca en una
    que mande el cliente. Quitar una foto borra también su miniatura.
  - Safari no codifica WebP: desde ahí la foto se sube sin miniatura y el
    botón avisa que hay que usar Chrome, Edge o Firefox.

## Mis versiones privadas

Full/VIP puede guardar varias copias personales por escena y variante. Se
crean desde Editar → Crear versión privada; Ajustes → Mis versiones abre la
biblioteca. La edición local anterior sigue disponible en todos los planes.

`api/versiones.js` usa el handler de `api/_versiones.js` y `resolveTier()`;
este último devuelve también `userId` desde la fila de la sesión. Todas las
consultas a `prompt_versions` filtran por ese dueño, incluso para un admin.
El tier permite abrir/crear/editar el texto; listar títulos y borrar sigue
permitido al dueño que bajó de plan. No se modifican los prompts originales.

La tabla sale de `supabase/mis-versiones.sql` (RLS activo, sin políticas,
sólo `service_role`), que se corrió en producción el 04/10/2026 y quedó
probada guardando una copia real. Las copias sobreviven a retirar una escena,
pero se borran al borrar la cuenta. Nunca pasan por el seed ni por git.

Se guarda una plantilla con centinelas, no el prompt renderizado. No mandar
campos de nombres ni Mis personajes, ni usar `KEY_EDITS` para cachear copias
de cuenta: son compartidas entre quienes usan ese navegador. Las activas sólo
viven en memoria, se limpian al salir/cambiar de cuenta y se renderizan desde
`textoFinal()`. `revision` evita pisar cambios guardados en otro dispositivo.
Cada cuenta guarda como mucho `MAX_VERSIONES` (100): al crear se cuentan las
suyas y pasado el tope responde 409 `version_limit`. Sin tope, una sola cuenta
Full podía llenar la base con plantillas de 20.000 caracteres. Ese conteo sólo
ahorra trabajo: el tope lo impone un trigger de la base
(`prompt_versions_limite_por_cuenta`), porque veinte pedidos simultáneos
pasaban de 99 a 119.
`node scripts/verify-versiones.mjs` prueba el handler con cuentas y datos
sintéticos. La privacidad está documentada en `privacidad.html`.

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
Desde este cambio, Pages publica también **sólo `data/modificadores.js`**.
Se carga en un contexto separado y actualiza las listas públicas de la página,
sin editar `catalog.js` ni adelantar `CATALOG_BUILT_AT`. Si falta ese archivo,
se usan las listas compiladas anteriores. El build y el validador de
combinaciones siguen leyendo la misma fuente en sus VM, sin duplicar IDs.

`node scripts/sync-modificadores.mjs` actualiza sólo las copias públicas de
`STYLES` y `OUTFITS` en `catalog.js`, sin leer prompts privados ni modificar
`CATEGORIES` o el sello. Se usa al cambiar estilos o prendas para que, si
falla la carga de modificadores, el respaldo no recupere reglas anteriores.

`Semirrecogido alto con volumen` agrega la referencia de coleta alta parcial,
ondas sueltas y dos mechones largos con raya al medio. Está disponible para
todos los planes y conserva identidad, rasgos y color de cada personaje.

Hay 10 estilos, 12 prendas y 10 peinados nuevos, con buscadores dentro de sus
paneles. Anime, manga, acuarela, gouache y otros medios ilustrados agregan una
dirección artística después de los extras: interpreta las instrucciones de
foto/poros como dibujo o pintura, preservando adultos, pose y prenda elegida.
No se modifica el original ni se afirma que esos estilos ya fueron probados
en una IA. `verify-modificadores.mjs` comprueba listas, VM, carga pública y sello.

**Todos los estilos y prendas se pueden combinar con cualquier escena**
(pedido del dueño, 20/10/2026), incluidas Hot e Íntimo y Sin Ropa.
Se retiró la marca `revela` y los permisos de cada plan se mantienen.
Cambiar de estilo conserva la prenda
elegida. `estiloPara()` y `prendaPara()` sólo descartan IDs desconocidos o
retirados. La copia individual y "Un nombre en todas" usan la misma regla.
Las 34 prendas previamente retiradas ya no tienen definición en la fuente;
el filtro de IDs se conserva para las copias antiguas en caché.

Las prendas activas describen su corte, tejido y caída sin imponer cobertura
de partes del cuerpo ni agregar forros, copas, prendas interiores o paneles
opacos. Los medios artísticos conservan la prenda seleccionada. No se cambian
poses, proporciones ni identidades para ocultar el cuerpo. Los filtros de
búsqueda, tipo, tela y favoritas sólo ayudan a encontrar opciones.

La prohibición de contenido con menores también se aplica a dibujos. La
dirección artística de ilustración sigue pidiendo adultos de 25 años o más,
con estructura facial y proporciones maduras, sin rasgos infantiles ni
uniformes escolares. Se agrega al final desde `textoFinal()` y también en
"Un nombre en todas", después de los demás ajustes.
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
npm run verify           # todas las verificaciones — correr siempre antes de commitear
npm run seed             # carga los prompts a Supabase (necesita las env vars)
node scripts/og.mjs      # rehace assets/og.png, la vista previa al compartir

node scripts/dev-server.mjs --tier full --admin   # servidor local
#   --ejemplos <id>,<id>   carga imágenes de relleno para probar la galería
node scripts/build-site.mjs        # arma build/site, lo que publican Pages y Vercel
```

`npm install` una vez: `verify` usa esbuild (dependencia de desarrollo) para
probar la página minificada.

El servidor de desarrollo simula la API completa sin Supabase. `--tier` cambia
el nivel simulado; `--admin` habilita el panel. Acepta `?__autoopen=<id>` para
capturas automatizadas. Sirve la fuente sin CSP: lo que la CSP bloquearía no
se ve ahí. Para eso está `node scripts/verify-csp-navegador.mjs`, que abre
`build/site` en Chromium con su CSP real.

## Verificaciones

| Script | Qué comprueba |
|---|---|
| `verify-catalog.mjs` | los 1188 prompts renderizan idénticos tras el round-trip |
| `verify-access.mjs` | página y servidor deciden igual el acceso; la lista GRATIS es válida |
| `verify-patreon.mjs` | umbrales de tier y firma del webhook |
| `verify-respaldo.mjs` | el respaldo del panel vuelve idéntico tras pegarlo |
| `verify-prompts.mjs` | salud del catálogo: no aparecen defectos nuevos |
| `verify-validar.mjs` | las validaciones del panel |
| `verify-versiones.mjs` | copias privadas: dueño, tier, revisiones y variantes |
| `verify-integridad.mjs` | el panel guarda en una sola llamada y el tope de versiones de la base vuelve como 409 |
| `verify-integridad-db.mjs` | sólo en CI, con un Postgres desechable: arma la base desde `schema.sql`, prueba el rollback, los permisos y 20 conexiones contra el tope |
| `verify-ejemplos.mjs` | subida con IDs acentuados, rutas vinculadas, miniaturas y limpieza de fallos |
| `verify-catalogo-api.mjs` | `/api/catalog`: caché pública sólo sin sesión, borradores sólo al admin, errores sin caché |
| `verify-minificado.mjs` | el index.html minificado compila y conserva nombres globales e ids |
| `verify-seguridad.mjs` | cookie, CSRF, OAuth, campaña, plazos del plan, caídas de Patreon, login con sesión abierta, webhook |
| `verify-sesion-pagina.mjs` | la página ante 401/5xx, cambio de cuenta, Atrás (bfcache) y el 403 inesperado |
| `verify-migracion.mjs` | "Traer mis ajustes": combina sin pisar, avisa lo conservado, rechaza otros orígenes |
| `verify-build-site.mjs` | lo que se publica: lista explícita, CSP, hash del script en línea, precargas, caché |
| `verify-rutas.mjs` | el sitio se arma desde una carpeta con espacios y tildes (Windows) |
| `verify-csp-navegador.mjs` | Chromium abre los dos orígenes bajo la CSP sin ninguna violación (se omite sin Chromium) |

Prueban con nombres que incluyen acentos, apóstrofes y un `$1` — ese último
rompe un `String.replace` mal escrito, y es un caso real que se encontró así.

## Deuda del catálogo

**Desde el 04/10/2026 casi toda esta deuda dejó de verse**: estaba en las
v1.2, que la página ya no ofrece (586 de los 588 defectos de la línea base).
Lo que sigue queda como historia; `rehacer-v12` y `aplicar-v12` ya no hacen
falta. La regla de no remitir a otro prompt sigue valiendo para Solo, Dúo y
Trío.

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
- **En Explorar las filas del accordion están ocultas** con
  `display:none !important`, salvo la elegida (`.catalogo-elegida`). Lo que
  mire si una fila "se ve" tiene que contar las tarjetas, o pasar a Lista.
  El filtro sigue poniendo `style.display` en las filas, y las tarjetas lo
  copian: hay un solo filtro.
- **Las funciones corren en `pdx1` (Oregón)**, por `regions` en
  `vercel.json`, porque la base de Supabase está en `us-west-2` (Oregón).
  Hasta el 25/10/2026 corrían en `iad1` (Virginia), la región por defecto, y
  cada consulta cruzaba el país (~65 ms de ida y vuelta): una carga hace
  de 2 a 6 seguidas. El visitante de Sudamérica o España llega ~50 ms más
  lejos a Oregón, pero se ahorra más que eso en la base. Si se muda la base,
  mover también esta región.
- **Vercel en el plan Hobby admite 12 funciones** por despliegue. Con
  `api/versiones.js` son 11: la próxima ruta nueva conviene sumarla a un
  archivo existente. Los archivos que empiezan con `_` (como
  `api/_miniaturas.js`) no cuentan: son módulos, no rutas.
- **`/api/catalog` se cachea sólo sin sesión.** Desde Pages: un minuto en el
  navegador y cinco en el CDN de Vercel (`Vercel-CDN-Cache-Control`), que
  pasado ese tiempo sigue sirviendo la anterior mientras pide la nueva y, si
  Supabase falla, la última buena por un día. En el origen de la cuenta la
  página lo pide siempre con `cuenta=1` y recibe `private, no-store`: la
  caché de Vercel no separa por cookie (sí lo hacía por `Authorization`),
  así que la URL distinta es lo que impide servirle a una cuenta la
  respuesta pública. Consecuencia: lo que se publica desde el panel tarda
  hasta ~5 minutos en verse sin cuenta. Desde el 23/10/2026 las variantes
  llegan dentro de cada categoría (`prompt_bodies(variant)`, por la clave
  foránea), en paralelo con lo demás: un solo viaje a Supabase. Antes eran
  varias consultas en fila y con sesión la respuesta tardaba 1,1–1,5 s, más
  que los 800 ms que espera la página, que entonces armaba la lista dos
  veces. Si la base no conociera la relación (`PGRST200`), vuelve sola al
  camino anterior y lo deja en el registro.
- **La página pide el catálogo del servidor al principio del script** y arma
  la lista una sola vez: espera esa respuesta hasta 800 ms
  (`ESPERA_CATALOGO_MS`) y, si tarda más, arma con el archivo estático y
  completa después, como antes. Antes se armaba dos veces al cargar (~0,4 s
  de JS cada una en un celular lento). Lo que necesite las filas antes de
  ese momento llama a `asegurarAccordion()` (`irACategoria` y los filtros ya
  lo hacen).
- **`content-visibility:auto` recorta lo que sobresale de la caja.** Por eso
  en las tarjetas va en el botón `.catalogo-abrir` y no en `.catalogo-tarjeta`:
  en la tarjeta cortaba el contorno de foco del teclado. Las filas ya tenían
  `overflow:hidden`, así que ahí no cambia nada visible. Además **mueve
  trabajo de la carga al scroll**: cada tarjeta se dibuja al acercarse. Con
  las 270 la carga bajaba ~270 ms de TBT, pero bajar seis pantallas sumaba
  ~570 ms de tareas largas (celular, CPU 4x). Por eso las primeras 24
  tarjetas no la llevan (`:nth-child(n+25)`): carga igual de liviana y las
  primeras pantallas sin trabas.
- **Armar la lista y Explorar al cargar era lo que más trababa el celular**
  (23/10/2026, 332 escenas, CPU 4x: ~1 s de tareas largas). Dos cambios:
  las filas clonan sus partes fijas (`PLANTILLA_FILA`, `iconoNodo()`) y
  escriben los textos con `textContent`, en vez de interpretar seis
  fragmentos de HTML por fila; y Explorar pinta ya sólo las primeras 24
  tarjetas visibles (`PRIMERAS_TARJETAS`) y el resto en tandas de 40
  (`pintarDiferidas()`), en el orden de la grilla. Todas las tarjetas están
  en la grilla desde el principio, así que el contador y el orden no
  cambian; una sin pintar no se vigila para su foto hasta pintarla.
  Medido con `node` y Playwright: de ~1,0–1,2 s a ~0,63 s de bloqueo, y la
  tarea más larga de ~0,5 s a ~0,28 s.
- **Las acciones de GitHub van fijadas por commit**, con la versión en un
  comentario (`@<sha> # v5`). Una etiqueta se puede mover, y el trabajo de
  Pages puede publicar el sitio. Para actualizar una, cambiar el commit y el
  comentario juntos; el registro del último deploy muestra el commit de cada
  etiqueta. El checkout no deja el token en `.git/config`
  (`persist-credentials: false`): ningún paso hace push.
- **Pages y Vercel publican lo que arma `scripts/build-site.mjs`**: una lista
  explícita de archivos, `index.html` minificado (`minificar.mjs`, con
  esbuild) y sus scripts en línea sacados a `assets/app-<hash>.js`, salvo el
  del aviso de edad, que queda en línea con su hash en la CSP. La fuente no
  cambia. Los nombres de primer nivel se conservan porque `catalog.js`,
  `modificadores.js` y los bloques se llaman entre sí por ellos;
  `verify-minificado.mjs` lo comprueba.
- **La CSP va en `<meta>`** (Pages no permite cabeceras) y permite sólo la
  API, Umami (`cloud.umami.is` y `gateway.umami.is`, donde van los eventos),
  Supabase (fotos y Panel → Miniaturas, que las baja con `fetch`) y Google
  Fonts. Un servicio externo nuevo hay que sumarlo en `build-site.mjs`; si
  no, se bloquea sin error visible. `verify-csp-navegador.mjs` lo detecta.
- **Una CSP en `<meta>` apaga el preload scanner de Chromium.** Los scripts
  del final del `<body>` se pedían de a uno, cada uno al terminar el
  anterior: el catálogo quedaba usable 0,8 s más tarde en el celular. Por
  eso `build-site.mjs` agrega un `<link rel="preload">` por cada uno en el
  `<head>`. Medido con CPU 4x: catálogo usable en 2,2 s (main 2,5 s; sin las
  precargas, 3,3 s).
- **Al cargar no se abre ninguna categoría.** Cuando había cupo semanal,
  abrir sola la primera le gastaba al visitante 1 de sus 5 prompts sin que
  eligiera nada. El cupo ya no existe, pero la regla sigue: lo primero que se
  ve tiene que ser algo elegido, no una categoría de prueba. En escritorio el
  panel vacío muestra la vitrina de categorías con fotos. **La única
  excepción** (pedido del dueño, 23/10/2026): si la persona salió con una
  escena abierta, al volver se reabre esa, que sí la eligió ella (ver
  **Continuar mi última escena**).
- **Los planes viven en una ventana** (`#planes`), no en la portada. Cualquier
  elemento con `data-abrir-planes` la abre, incluido el candado de una
  categoría bloqueada.
- **En escritorio el cuerpo de la sección se MUEVE** al panel de detalle, no se
  copia. Hay que devolverlo antes de reconstruir el accordion. Pasa recién
  cuando terminó de cargar; mientras tanto el panel muestra
  `detalleCargando()`, que no toca el cuerpo.
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
- **"Un nombre en todas" pide `GET /api/prompt?todas=1`**: la v1 Solo de
  cada escena que el plan alcanza, en un solo pedido (~350 KB). Antes sólo
  armaba las escenas ya abiertas en ese navegador y alguien nuevo recibía 0.
  El acceso se decide con `resolveTier()` y `canAccess()`, igual que el pedido
  de a una. Si la API no lo conoce, la página vuelve a lo de antes.
  Con hasta 50 escenas permitidas (el plan gratis) se le piden a la base
  sólo esas: hasta el 21/10/2026 cada pedido sin cuenta leía todas las v1, y
  un script que lo repitiera gastaba la transferencia mensual de Supabase.
- **`assets/og.png` tiene que salir con la fuente Inter.** `scripts/og.mjs`
  la toma de Google Fonts; sin conexión a eso usa la de reemplazo y la imagen
  queda con otra letra. Pasó con la que hubo hasta el 01/10/2026.
- **El Formato cambia la línea `16:9 4K ultra-sharp resolution.`** del
  prompt, en `cambiarFormato()`. Si el prompt pide 16:9 con otras palabras
  ("16:9 widescreen wallpaper format", "16:9 format"), cambia esa frase; si
  no menciona ninguna, agrega la línea al final. Hasta el 01/10/2026 elegir
  otro formato no hacía nada en esas escenas, entre ellas dos de las gratis.
- **El texto que se copia sale de un solo lugar**: `textoFinal()` dentro del
  cuerpo de cada escena. La vista previa lo usa también, así que muestra
  exactamente lo que se va a copiar. Antes había seis copias de esa lógica,
  una por botón.

## La página

- **Barra de arriba** (`#toolbar`): marca, buscador y cuenta. En el celular
  son dos filas y sólo queda pegada la del buscador: la barra tiene
  `top` negativo del alto de la primera fila (`--fila1`). Lo que se lleva
  arriba con scroll tiene que descontar `altoPegado()`, no el alto entero.
- **Portada** (`#lp-section`): texto y una foto de ejemplo grande, sin
  recortar, con hasta 4 chicas debajo. Si no hay fotos la columna se va
  (`.sin-fotos`). Se puede ocultar y se recuerda en `wp_lp_collapsed_v1`.
- **Generador**: arranca en **Explorar**, una grilla de tarjetas
  (`#catalogo-grilla`) que primero muestra las que tienen una foto visible
  para ese visitante (Casual/Editorial siempre, Hot con Premium/Full e
  Íntimo con Full y sesión); **Lista**
  vuelve a la lista de siempre. No se guarda: cada visita empieza en
  Explorar. Elegir una tarjeta abre la misma escena de siempre: las
  tarjetas no tienen lógica de acceso propia, leen las filas del accordion.
  Las miniaturas salen del pedido único de fotos (`/api/ejemplos?todas=1`) y
  cada tarjeta la pinta al acercarse a la pantalla; las URLs quedan en
  memoria cinco minutos y se descartan al cambiar de sesión. En **Lista**,
  cada fila visible muestra la misma miniatura y la quita si la sesión ya
  no permite verla (`pintarFilas()`). Las tarjetas
  que ya están en orden conservan su nodo cuando llega otra foto, y cada
  foto que llega redibuja sólo su tarjeta: el orden y el contador dependen
  de qué fotos se pueden ver, no de cuáles ya cargaron. El contador
  incluye sólo las categorías del filtro cuya
  foto puede ver ese visitante, aunque su prompt tenga candado.
  Desde 1100px, lista a la izquierda y panel a la derecha, cada uno del alto
  de la pantalla y con su propio scroll. Por debajo, el accordion.
- **Búsqueda natural**: compara términos y equivalencias de español/inglés
  contra nombre, subtítulo e ID públicos, sin leer cuerpos ni guardar consultas.
  Respeta todos los filtros. Sin resultados sugiere búsquedas que sí tienen
  coincidencias en el filtro actual. "Para celular" orienta a Formato 9:16;
  no clasifica escenas como compatibles o incompatibles sólo por su nombre.
- **Guía "Tu primer prompt"** (`#primera-guia`): opcional, desde el enlace
  de la portada. Sigue la escena abierta y el evento `wp-prompt-copiado`;
  no guarda nada.
- **Barra de copiar en el celular** (`#copia-movil`): fija abajo mientras la
  escena abierta está a la vista. Aprieta el botón Copiar original: no arma
  el prompt ni decide permisos. Se esconde al escribir o con una ventana
  abierta. Corre en cada scroll y en cada cambio del accordion, así que
  primero mira lo barato (escritorio, sin escena abierta, escribiendo) y
  recién después mide; sólo toca el DOM si cambia algo. Hasta el 17/10/2026
  medía la página entera antes de decidir y era lo que más JS gastaba al
  cargar, también en escritorio.
- **Ayuda**: la sección "Antes de empezar" (`#ayuda-prompts`) y el diálogo
  "¿Dónde lo pego?", que el aviso de Copiado ofrece sólo en la primera
  copia de cada visita.
- **Cuerpo de una escena**: dos columnas (foto y texto / controles) cuando el
  panel mide 760px o más, con una *container query*: depende del lugar que le
  toca, no del ancho de la ventana. En una columna, `.det-media` y `.det-ctl`
  se disuelven con `display:contents` y el orden lo da `order`, para que el
  nombre y Copiar queden antes que el texto del prompt.
- **Para quién** (Solo / Dúo / Trío) va separado de **Ajustar el prompt**
  (Estilo, Prenda, Formato, Extras, Editar). Abrir un ajuste ya no esconde el
  campo del nombre, y cada botón dice qué hay elegido.
- **"Vas a copiar"** (`.det-resumen`): junto a Copiar, una línea con lo
  elegido (modo, estilo, formato, prenda, peinado, extras, texto editado).
  Lee el mismo estado que `textoFinal()`; nunca muestra los nombres.
- **"Probar gratis" y "Empezar gratis"** activan el filtro Gratis. Si el clic
  llega antes que `/api/catalog`, el filtro se aplica al llegar.
- **Error de login** (`#patreon-auth-error`): si Patreon vuelve con
  `?auth=error` (también al cancelar), aviso con botón Reintentar. Vuelve al
  origen donde empezó: desde Pages, a Pages, donde están sus ajustes.
- **Traer mis ajustes** (`#aviso-ajustes`, `assets/migrar-ajustes.js`): sólo
  en el origen de la cuenta. Se ofrece una sola vez (queda recordado al
  mostrarse, en `wp_migracion_v1`); después está en Ajustes. Abre `migrar-ajustes.html` de Pages en una ventana y copia por
  `postMessage` personajes, favoritas, ocultas, ediciones y preferencias.
  Une listas por id o nombre, suma lo que falta y no pisa lo que ya hay;
  dice cuántos datos conservó.
- **Galería de ejemplos**: flechas, "Ejemplo 1 de 2", foto sin recortar y
  ampliación con botón de cerrar. Bloqueada, ofrece "Ver planes para acceder".
- **Continuar mi última escena**: un botón del generador recupera el último
  ID abierto cuyo prompt pudo cargar. Sólo se guarda ese ID en
  `wp_last_scene_v1`, sin nombres, ajustes, textos ni token. Respeta
  ocultas/retiradas, el servidor comprueba el acceso al retomar y se olvida
  al salir/cambiar de sesión: la marca pública `wp_session_id_v1` cambia o
  `verify` responde 401.
  **Volver donde quedó** (desde el 23/10/2026): si al salir la escena seguía
  abierta, al volver se reabre sola y en el mismo modo (Solo, Dúo o Trío).
  En el celular, salir a otra app suele descartar la pestaña y la página se
  recargaba en la portada. `wp_open_scene_v1` guarda `id` o `id|duo`/`id|trio`
  mientras está abierta y cargó su prompt; se borra al cerrarla, al volver a
  Explorar, al reconstruir la lista y al cambiar de sesión. Se reabre en
  `reabrirEscenaAbierta()`, recién cuando llegó el catálogo, y no se cuenta
  como `abrir-escena` en las métricas. El nombre escrito no se guarda.
- **Planes**: los tres comparados punto por punto (Escenas, Estilos y
  prendas, Temas) y el roadmap en un desplegable.
- **Ajustes** (el engranaje) es una ventanita encima de la página: color,
  orden, vista compacta, Ocultas, "Un nombre en todas", Mis versiones, el
  tema VIP y el Panel del admin.
- **Mis personajes**: cada nombre tiene un botón Eliminar visible, que pide
  confirmación. Antes era una ✕ que sólo aparecía al pasar el mouse.
- **Aviso de mayoría de edad** (`#edad`): tapa todo en la primera visita y
  deja el resto `inert` hasta que se confirma. Se recuerda en `wp_edad_v1`
  (por origen: Pages y la cuenta lo piden por separado, salvo que se traigan
  los ajustes), y un script en línea en el `<head>` lo esconde antes de
  pintar para que no parpadee en cada visita. Enlaza a `terminos.html` y `privacidad.html`,
  que el workflow de Pages publica sueltas junto con `assets/legal.css`.
- **Métricas**: Umami, sin cookies. Se activa poniendo el id en `UMAMI_ID`
  de `index.html`; vacío no carga nada. Todo pasa por `medir()`, que nunca
  tiene que recibir nombres de personajes ni texto de un prompt. Eventos:
  `abrir-escena`, `copiar`, `ver-planes`, `ir-a-patreon`, `entrar`,
  `edad-confirmada`. Si se agrega algo que se guarde o se mida, hay que
  contarlo en `privacidad.html`.

## Trabajar con otro asistente

ChatGPT trabaja con acceso al repo por GitHub, en ramas `gpt/<tema>` y con
Pull Requests hacia `main`. Por instrucción del dueño (20/10/2026), Claude ya
no es revisor obligatorio. Antes de integrar se revisan el diff, las
verificaciones, la prueba en navegador y la compatibilidad con otros PR.
Si falta un recurso privado o una herramienta de prueba, se documenta la
limitación concreta; no se presenta esa comprobación como aprobada.
Nunca dos asistentes tocando el mismo
archivo a la vez: `index.html` es uno solo y se pisan.

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

Al día del 23/10/2026. Hecho y desplegado desde el 18/09: portada rediseñada
(fotos arriba, marca única Wallpaperia, planes en ventana, capa visual
futurista, "Cómo funciona"), acceso simplificado a 5 gratis fijas sin
rotación ni cupo, 5 imágenes de ejemplo cargadas, post gratis de Patreon,
permisos explícitos de la Data API para el cambio de Supabase del 30/10, y
los scripts `post-gratis`, `rehacer-v12` y `aplicar-v12`.

El 27/09 se rediseñó la pantalla entera (ver **La página**): ancho completo,
barra fija con buscador, portada con mosaico de fotos, lista y panel del alto
de la pantalla, vista previa igual a lo que se copia, temas que ahora sí
cambian de color, avisos sin emoji y la papelera fuera de cada fila.

Del 28/09 al 02/10: precios $2/$5, aviso de mayoría de edad, Términos y
Privacidad, Umami, token en el fragmento, peinados, generador por bloques,
la v1.2 de `beach-wet-dress`, y los PR #6 a #20 entre GPT y Claude: vista
Explorar, guía del primer prompt, barra de copiar en el celular, ayuda,
Mis personajes con Eliminar visible y Mis versiones (activa desde el 04/10).

Del 03/10 al 04/10: "XXX" pasó a llamarse "Íntimo", búsqueda en español,
"Continuar mi última escena", "Comparar con el original", 32 opciones nuevas
con buscador, el anime con sus límites originales (PR #24 a #31, reemplazados
por la regla de modificadores del 20/10) y, el 04/10, se
sacó la v1.2 "+PIEL": quedan Solo, Dúo y Trío. En espera, sin
cerrar, quedaron los PR de GPT #22 (combinaciones), #23 (carpetas), #26
(fichas de pruebas) y #28 (métricas en el panel): sumaban SQL o claves nuevas
para funciones que todavía nadie pidió, y se cerraron el 23/10.
El 04/10 también se actualizaron los niveles de Patreon con lo mismo que dice
la ventana de Planes: Premium $2 (Casual, Editorial y Hot) y Full $5 (más
las Íntimas, los temas VIP y Mis versiones). Si cambia uno, cambiar el otro.

Al 23/10/2026: miniaturas generadas, las 335 escenas publicadas con foto,
pedido único de fotos, carga más liviana en el celular, volver a la escena
abierta y el catálogo con sesión en un solo viaje (PR #55 a #58). Se integró
el PR #49 de GPT (guardado atómico y tope de versiones en la base), y los
#22, #23, #26 y #28 se cerraron sin integrar: si se retoma alguna de esas
funciones, conviene rehacerla sobre el `main` actual. `schema.sql` crea ahora
`users` y `sessions`, y las acciones de GitHub corren en Node 24.

**Para retomar, en orden de valor:**

1. **Las 8 categorías con pose vaga**, que el panel ya marca con un aviso.
2. **El arranque en frío de Vercel**: la primera visita después de un rato
   sin uso tarda ~4,5 s en responder.

**Sin resolver, de siempre:**

- Desde el refuerzo de seguridad (20/10/2026) las sesiones anteriores
  requieren volver a entrar. Sólo una marca no secreta queda en
  `wp_session_id_v1` para limpiar vistas al cambiar de cuenta; nunca se
  envía como credencial. Los prompts canónicos se cachean únicamente en
  memoria. `_esc()` sigue siendo obligatorio: la CSP no permite JS en línea
  ni eval, pero un XSS igual podría leer lo que muestra la página.
- Entrar en un dispositivo cierra la sesión en los demás (el callback borra
  las filas de ese usuario). Era así antes; el atajo de `login.js` evita que
  pase sólo por tocar "Entrar" teniendo ya una sesión abierta.
- Los temas se deciden en el cliente. Es cosmético y se corrige solo al
  recargar; no desbloquea contenido.
- Hay **144 categorías** publicadas que viven sólo en Supabase y llegan por el
  delta (al 23/10; eran 74 el 02/10 y 16 el 27/09). No tienen respaldo: el
  dueño decidió no hacerlo por ahora. Para que pasen al archivo estático: **⚙ Panel →
  Respaldo**, pegar en `data/prompts.js`, y recién entonces
  `npm run build:catalog -- --sello-nuevo`. Sin copiarlas primero, adelantar
  el sello las borra del sitio.

Más detalle operativo en `DEPLOY.md`.
