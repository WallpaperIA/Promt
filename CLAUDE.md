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

- **Una sola página.** `index.html`, ~3400 líneas, HTML/CSS/JS sin frameworks
  ni build step. Se edita directo.
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
   el tier del lado del servidor, nunca leerlo del pedido.

5. **`npm run verify` tiene que pasar** antes de cualquier commit que toque
   prompts, acceso o validaciones. Son 58 comprobaciones.

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
| `free` | casual + editorial, **5 prompts distintos por semana**, más 1 hot y 1 xxx rotativos |
| `premium` | todo lo hot, más 5 xxx rotativos |
| `full` | todo, más los temas VIP |

La rotación es determinista por número de semana y **se calcula igual en el
cliente y en el servidor**. `scripts/verify-access.mjs` comprueba que
coincidan en 119.400 casos. Si se toca una, hay que tocar la otra.

Los umbrales de aporte están en `api/_patreon.js` y se comparan con **mayor o
igual**, nunca por igualdad: $10+ es `full`, $7+ es `premium`. Antes era un
mapa exacto y quien aportaba $8 o $20 quedaba como `free`.

`is_admin` en la tabla `users` da acceso total y lo respetan los tres caminos
(revalidación, webhook y endpoint de prompts). Es para el dueño del proyecto.

## Flujo de publicación de categorías

```
borrador ──verificaciones OK + "ya la probé"──> prueba ──publicar──> publicada
```

Se maneja desde el **panel de administración** dentro de la app (botón ⚙ Panel,
sólo visible con `is_admin`). Sin publicar, una categoría devuelve 404 para
todos salvo el admin.

Editar **invalida la prueba anterior**: lo aprobado ya no es lo que hay.

La **papelera** del encabezado sólo oculta, en ese navegador y nada más. El
borrado real es el botón **Eliminar para siempre** que aparece ahí siendo
admin: borra de Supabase y deja el id en `deleted_categories`. Esa lápida no
es opcional — sin ella las 199 originales seguirían en el `catalog.js` que ya
bajó cada visitante, y el próximo `npm run seed` las resucitaría desde
`data/prompts.js`.

Las verificaciones están en `api/_validar.js` y comprueban **formato, no
calidad**. El build genera `data/validar.js` desde ese mismo archivo quitándole
los `export`, así el navegador y el servidor usan la misma lógica sin
duplicarla. **No editar `data/validar.js`**: los cambios van en `api/_validar.js`.

## Los modificadores

Cuatro listas que se aplican encima de cualquier prompt, en
`data/modificadores.js` — versionado, porque no contienen ningún prompt y ya
se publican tal cual dentro de `catalog.js`:

| Lista | Qué hace |
|---|---|
| `STYLES` | reemplazan la apertura (`prefix`) |
| `OUTFITS` | agregan una nota de vestuario al final (`instruction`) |
| `FORMATS` | cambian la línea de resolución (`suffix`) |
| `DETAILS` | suman detalles al final; el campo `group` arma las secciones solo |

Agregar una opción es agregar un objeto a la lista y correr `build:catalog`.
`STYLES` y `OUTFITS` tienen `tier`; `FORMATS` y `DETAILS` son para todos.

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
```

El servidor de desarrollo simula la API completa sin Supabase. `--tier` cambia
el nivel simulado; `--admin` habilita el panel. Acepta `?__autoopen=<id>` para
capturas automatizadas.

## Verificaciones

| Script | Qué comprueba |
|---|---|
| `verify-catalog.mjs` | los 1188 prompts renderizan idénticos tras el round-trip |
| `verify-access.mjs` | cliente y servidor deciden igual el acceso, 200 semanas |
| `verify-patreon.mjs` | umbrales de tier y firma del webhook |
| `verify-validar.mjs` | las validaciones del panel |

Prueban con nombres que incluyen acentos, apóstrofes y un `$1` — ese último
rompe un `String.replace` mal escrito, y es un caso real que se encontró así.

## Trampas conocidas

- **`set -o pipefail` con `grep -q`**: el corte temprano manda SIGPIPE y la
  tubería devuelve 141, que se lee como "no encontrado". Usar `grep -c`.
  Esto hizo que una verificación diera limpio siempre.
- **Git en Windows** convierte a CRLF al hacer checkout; los scripts escriben
  LF. Hay un `.gitattributes` que fuerza LF. Sin él, cada build dejaba
  `catalog.js` marcado como modificado y bloqueaba los cambios de rama.
- **El init abre la primera sección** con `classList.add('open')` directo, sin
  pasar por el handler de click. Cualquier cosa que dependa de abrir una
  sección tiene que engancharse también ahí.
- **En escritorio el cuerpo de la sección se MUEVE** al panel de detalle, no se
  copia. Hay que devolverlo antes de reconstruir el accordion.
- **Las capturas headless** no pueden usar `scrollIntoView` con scroll suave:
  no completa. Filtrar con el buscador para llevar el elemento arriba.

## Estilo

- **Comentarios en castellano**, explicando *por qué*, no *qué*. Los que hay
  documentan decisiones y bugs pasados: conservarlos.
- **Nada de emojis en la interfaz.** Hay un sprite de 30 iconos SVG que heredan
  `currentColor` y siguen los cuatro temas. Los emojis traían sus propios
  colores fijos y ensuciaban la pantalla.
- **`cleanName()`** quita los emojis de los nombres de categoría al mostrarlos.
  El dato queda intacto; es sólo presentación.
- **Escapar siempre** lo que va a `innerHTML` con `_esc()`.
- Los cambios se verifican **en navegador**, no sólo compilando. Hay
  herramientas para eso en `scripts/`.

## Pendientes conocidos

Dos pasos de puesta en marcha, pendientes a propósito:

- **La rama `claude/zen-goldberg-r04pne` no está en `main`.** Lleva los
  modificadores nuevos, los arreglos de `applyStylePrefix`, el borrado
  definitivo y la conservación del sello. Hasta que se haga el merge nada de
  eso se ve en el sitio.
- **Falta crear `deleted_categories` en Supabase**, con el bloque que está en
  `supabase/schema.sql`. Sin esa tabla, "Eliminar para siempre" falla al
  usarse.

Y lo de siempre, documentado y sin resolver:

- El token de sesión viaja en la URL al volver de Patreon y queda en logs del
  CDN. El arreglo es una cookie HttpOnly cross-site.
- El cupo free de anónimos se agrupa por IP: una conexión móvil con IP
  rotativa obtiene más de 5. Se resuelve pidiendo login también para el free.
- Los temas se deciden en el cliente. Es cosmético y se corrige solo al
  recargar; no desbloquea contenido.
- Hay 11 categorías publicadas que viven sólo en Supabase y llegan por el
  delta. Para que pasen al archivo estático hay que copiarlas a
  `data/prompts.js` y recién entonces reconstruir con `--sello-nuevo`. Sin
  copiarlas primero, adelantar el sello las borra del sitio.

Más detalle operativo en `DEPLOY.md`.
