# Despliegue

El sitio es estático (GitHub Pages) y el gating vive en funciones serverless
(Vercel) contra Supabase. Los prompts ya no viajan en el bundle.

El catálogo para visitantes conserva GitHub Pages. Al entrar, la cuenta abre
en `https://promt-iota.vercel.app/`: página y API comparten origen para no
depender de cookies de terceros.

```
data/prompts.js      fuente de los prompts (NO se publica — ver "Pendiente")
      │
      │  npm run build:catalog
      ▼
data/catalog.js      metadata pública, 60 KB → GitHub Pages
build/prompts.seed.json   cuerpos, 1,2 MB → Supabase (gitignored)
```

## Variables de entorno en Vercel

| Variable | Dónde se usa | Notas |
|---|---|---|
| `SUPABASE_URL` | todas las funciones | |
| `SUPABASE_SERVICE_KEY` | todas las funciones | service_role. Nunca en el cliente. |
| `PATREON_CLIENT_ID` | `auth/login`, `auth/callback` | |
| `PATREON_CLIENT_SECRET` | `auth/callback` | |
| `PATREON_CAMPAIGN_ID` | login, revalidación y webhook | ID público de Wallpaperia: `16786741`. Sin configuración válida no se concede un plan pago. |
| `PATREON_WEBHOOK_SECRET` | `webhooks/patreon` | El secreto que muestra Patreon al crear el webhook. Sin esto el webhook rechaza todo, para que nadie pueda cambiar tiers con un POST. |

## Puesta en marcha

### Publicar el refuerzo de seguridad

Dos orígenes: **GitHub Pages** (`https://wallpaperia.github.io/Promt/`) es el
catálogo para visitantes, sin sesión; **Vercel** (`https://promt-iota.vercel.app/`)
sirve la misma página junto a la API y es donde vive la cuenta. La sesión es
una cookie `__Host-wp_session` HttpOnly/Secure/SameSite=Lax de 30 días; en
`sessions.token` sólo se guarda su SHA-256. Desde Pages la cookie no viaja
(es de otro sitio): por eso entrar lleva a Vercel.

En orden:

1. **Antes de combinar**, ejecutar `supabase/seguridad-sesiones.sql` en el SQL
   Editor. Se aplicó el 19/10/2026, pero ahora también comprueba que
   `sessions.token` sea `text` y, si fuera `uuid` o un `varchar` corto, lo
   convierte: la API nueva guarda un hash de 64 caracteres y con otro tipo
   nadie podría entrar. Se puede repetir sin riesgo y es compatible con la
   API actual (no cierra sesiones ni cambia planes).
2. `PATREON_CAMPAIGN_ID=16786741` en Vercel (ya está en Production y
   Preview). El callback registrado en Patreon no cambia.
3. Combinar el PR. Pages (pestaña Actions) y Vercel publican solos; los dos
   arman el sitio con `scripts/build-site.mjs` (Pages en `_site`, Vercel en
   `build/site`), que copia una lista explícita de archivos.
4. **Después de publicar**, ejecutar `supabase/cerrar-sesiones-heredadas.sql`:
   borra las sesiones del sistema anterior (las que no son un hash) sin tocar
   las cookies nuevas. Todos tienen que volver a entrar una vez. Mantener la
   protección de Vercel sobre las URLs de despliegues anteriores (comprobada:
   `all_except_custom_domains`), para que sus APIs viejas no sean otra puerta.
5. Comprobar: entrar con Patreon en Vercel, abrir una escena paga, Panel y
   Panel → Miniaturas, Mis versiones, salir. Desde Pages, `/api/catalog`
   responde `HIT` del CDN; en Vercel la página lo pide con `cuenta=1` y
   recibe `private, no-store`, con o sin sesión. En la consola del
   navegador no tiene que haber avisos de CSP y Umami tiene que mandar
   eventos a `gateway.umami.is`.

**Cuánto vale un plan comprobado.** `verify` revalida contra Patreon al
cargar la página si pasaron 6 h (`FRESCURA_TIER_MS`). Los demás pedidos
aceptan el plan comprobado contra la campaña durante 72 h
(`VALIDEZ_TIER_MS`): con una sola ventana de 6 h, quien dejaba la pestaña
abierta pasaba a free a mitad de la visita, y una caída de Patreon dejaba
sin acceso a todos. Si Patreon dice que ya no es miembro, baja en el acto;
si Patreon no responde, se conserva lo comprobado hasta las 72 h. Las bajas
llegan además al instante por el webhook, que cierra las sesiones. Un plan
sin `patreon_campaign_id` de la campaña no vale nunca.

**CSP.** Va en un `<meta>` (Pages no deja poner cabeceras) y la arma
`build-site.mjs`. Permite: la API (`promt-iota.vercel.app`), Umami
(`cloud.umami.is` para el script y `gateway.umami.is` para los eventos), las
fotos y Panel → Miniaturas (`auichymkshiljqdtysqm.supabase.co`) y Google
Fonts. Ningún script en línea salvo el del aviso de edad, permitido por su
hash. Los demás se publican como `assets/app-<hash>.js`, que Vercel guarda en
caché un año (el nombre cambia con el contenido). Si se agrega un servicio
externo, hay que sumarlo ahí: `verify-csp-navegador.mjs` falla ante
cualquier bloqueo.

**Ajustes del enlace anterior.** Lo guardado en Pages (personajes,
favoritas, ajustes) queda en ese origen del navegador. La primera vez en
Vercel aparece un aviso "Traer mis ajustes"; también está en Ajustes. Copia
por `postMessage` entre las dos ventanas, con origen y nonce comprobados, sin
pasar por el servidor. Une listas y personajes sin pisar lo que ya haya y
dice cuántos datos conservó.

`node scripts/verify-seguridad.mjs` ejecuta los handlers reales con datos
sintéticos (cookies, CSRF, OAuth, frescura del plan, caídas de Patreon,
webhooks). `verify-build-site.mjs` y `verify-csp-navegador.mjs` comprueban
el artefacto y su CSP; `verify-sesion-pagina.mjs` y `verify-migracion.mjs`,
la sesión en la página y la migración de ajustes.

### Instalación inicial

1. **Esquema.** Pegar en el SQL Editor de Supabase, en este orden:
   `supabase/schema.sql` (crea también `users` y `sessions`),
   `supabase/mis-versiones.sql` y el archivo de `supabase/migrations/`.
   Los tres son idempotentes. Verificar después que RLS quedó activo en todas
   las tablas de `public` y que `anon` y `authenticated` no tienen permisos:
   sin eso, la anon key alcanza para leer todos los prompts. Sin la función
   de `migrations/`, el panel no puede guardar escenas.

2. **Construir el catálogo.**
   ```bash
   npm run build:catalog
   npm run verify          # round-trip + paridad cliente/servidor
   ```
   `verify` tiene que pasar antes de seguir. Compara los 1188 prompts byte a
   byte y confirma que servidor y cliente deciden igual el acceso.

3. **Cargar los datos.**
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… npm run seed -- --dry-run
   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… npm run seed
   ```

4. **Tu propio acceso.** Entrá una vez con Patreon para que se cree tu fila, y
   después en Supabase:
   ```sql
   update users set is_admin = true where email = 'tu@email.com';
   ```
   `is_admin` da acceso total y lo respetan la revalidación, el webhook y el
   endpoint de prompts. Poner `tier = 'full'` a mano no alcanza: la próxima
   revalidación contra Patreon lo pisaría con lo que diga tu suscripción.

   Reemplaza a la backdoor `?admin=` y a los códigos, que se eliminaron porque
   sus secretos viajaban en el fuente público.

5. **Desplegar** Vercel (funciones) y hacer merge a `main` (Pages). El
   workflow de Pages corre `npm ci` y publica `index.html` minificado con
   `scripts/minificar.mjs`; la fuente del repo queda igual.

## Activar Mis versiones privadas

Antes de publicar este cambio, ejecutar `supabase/mis-versiones.sql` en el
SQL Editor de la base del proyecto. No requiere seed ni modifica el catálogo.
El script toma el tipo real de `users.id`, crea `prompt_versions` con RLS y
sin políticas, y da permiso sólo a `service_role`. Es idempotente y transaccional.

Comprobar que RLS está activo, que `pg_policies` no devuelve políticas para
esta tabla y que `anon`/`authenticated` no tienen permisos. Publicar después
las funciones en Vercel y la página mediante el PR habitual.

`GET /api/versiones` lista sólo títulos/metadatos de la sesión (50 por página).
Leer una plantilla con `?id=`, crearla o editarla exige Full/VIP. El dueño puede
borrarla aunque baje de plan; cancelar no destruye las copias. Un administrador
tampoco puede leer las de otra cuenta. `resolveTier()` devuelve el identificador
del dueño desde la misma consulta que resuelve el plan. El navegador sólo manda
el token, nunca el dueño ni el tier.

Las actualizaciones incluyen `revision`: si otro dispositivo guardó antes,
responde 409 y la página conserva el borrador. No hay copias de cuenta en
localStorage ni métricas nuevas. Los nombres y datos de Mis personajes se
completan en el navegador; no se envían con la plantilla.

Prueba aislada del handler, con cuentas y textos sintéticos:
`node scripts/verify-versiones.mjs`. Además de los tres verificadores que
funcionan sin `data/prompts.js`, esta prueba cubre dueños, tiers, sesión vencida,
revisiones y las seis variantes. No sustituye probar la migración en Supabase.

## Sincronización con Patreon

El tier vive en la tabla `users` y `/api/prompt` lo lee de ahí en cada pedido,
así que un cambio en esa fila se aplica al instante. Lo que hay que garantizar
es que esa fila refleje la realidad. Tres mecanismos, en orden de inmediatez:

1. **Webhook** — Patreon avisa al momento de suscribirse, cambiar de plan o
   cancelar.
2. **Revalidación** — `verify.js` relee el tier contra Patreon si pasaron más
   de 6 horas desde la última comprobación. Es la red por si el webhook falla
   o no está configurado.
3. **Login** — al entrar se recalcula.

### Configurar el webhook

En Patreon → **Developers → Webhooks** → crear uno:

- **URL:** `https://promt-iota.vercel.app/api/webhooks/patreon`
- **Eventos:** `members:pledge:create`, `members:pledge:update`,
  `members:pledge:delete`, `members:update`, `members:delete`

Copiá el secreto que muestra y cargalo en Vercel como `PATREON_WEBHOOK_SECRET`.

Patreon firma cada envío con HMAC-MD5 del cuerpo. Si la firma no valida, el
webhook responde 401: sin eso, cualquiera podría ascender o degradar cuentas
con un POST.

### Umbrales de tier

Están en `api/_patreon.js` y se comparan con **mayor o igual**, no por
igualdad:

| Aporte | Tier |
|---|---|
| $5 o más | `full` |
| $2 a $4,99 | `premium` |
| menos de $2 | `free` |

Antes era un mapa exacto de $7 y $10: cualquier otro monto quedaba como
`free`, así que los que aportaban de más eran los que menos recibían.

Si cambiás los precios en Patreon, actualizá `UMBRALES` en ese archivo.

## Panel de administración

Aparece un botón **Panel** dentro de ⚙ Ajustes (el engranaje de la barra de arriba), sólo si tu fila
tiene `is_admin = true`. El botón se agrega recién cuando el servidor lo
confirma: el permiso nunca lo decide el navegador.

### Flujo

```
borrador  ──verificaciones OK + "ya la probé"──>  prueba  ──publicar──>  publicada
```

- **borrador** — se guarda aunque tenga errores, para poder dejarlo a medias
- **prueba** — pasó las verificaciones automáticas y confirmaste que la probaste
- **publicada** — visible para los suscriptores

Editar una categoría **invalida la prueba anterior**: lo aprobado ya no es lo
que hay, así que vuelve a borrador. Y una publicada no se borra sin
despublicarla primero.

### Eliminar para siempre

**Ocultar** una escena (en su panel, o en la fila abierta en el celular) sólo
la oculta, y sólo en ese navegador: se guarda en `localStorage` y no toca la
base. Para los suscriptores es lo correcto. Vuelven desde ⚙ Ajustes →
**Ocultas**; en el código sigue llamándose papelera.

Siendo admin, cada categoría en Ocultas suma **Eliminar para siempre**.
Eso sí borra de Supabase la fila y sus prompts, esté publicada o no, y pide
confirmación con el nombre. No se puede deshacer.

El id queda en la tabla `deleted_categories`. Hacen falta las dos cosas porque
borrar la fila no alcanza:

- las 199 originales también viven en el `data/catalog.js` que ya bajó cada
  visitante, y sin la lápida seguirían en la lista y fallarían al abrirse;
- `npm run seed` las volvería a subir desde `data/prompts.js`, que no se toca
  al borrar.

`GET /api/catalog` devuelve esa lista a todos y el navegador las descarta; el
seed saltea esos ids y avisa cuáles omitió. Para revivir una:

```sql
delete from deleted_categories where id = 'la-categoria';
```

y correr `npm run seed` de nuevo. Sólo funciona si sigue en `data/prompts.js`:
una creada desde el panel no está ahí y no vuelve.

### Qué verifica

Formato, no calidad. Están en `api/_validar.js` y corren en los dos lados: el
servidor decide, el navegador las muestra mientras escribís.

- `id` único y con formato válido
- centinelas correctos: `__N__` en Solo, `__N1__`/`__N2__` en Dúo, etc.
- ningún `${...}` sin convertir ni centinela inventado
- que no falte un nombre en Dúo o Trío
- v2 sin v1
- largos razonables
- **que el texto renderice de verdad** con nombres que incluyen acentos,
  apóstrofes y un `$1` que rompería un replace mal escrito

Que el prompt genere una buena imagen no lo puede saber un programa. Por eso
hace falta el botón **"Ya la probé y funciona"**, que registra cuándo y con qué
la probaste.

### Cómo llega a los suscriptores

`data/catalog.js` es un archivo estático compilado en un momento dado. Una
categoría creada desde el panel es posterior a ese sello, así que no estaría
ahí. `GET /api/catalog?desde=<sello>` devuelve el delta —lo creado o editado
después— y el navegador lo incorpora. Normalmente devuelve una lista vacía.

Conviene correr `npm run build:catalog` y desplegar cada tanto, para que lo
publicado pase al archivo estático y el delta vuelva a quedar chico.

Sin cuenta, esa respuesta se cachea: un minuto en el navegador y cinco en el
CDN de Vercel. Lo que se publica tarda hasta ~5 minutos en verse sin sesión;
con sesión (el admin incluido) se ve enseguida, porque nunca se cachea.

### Miniaturas de las fotos de ejemplo

Las tarjetas usan una versión de 640 px en WebP (~27 KB) de cada foto. Al
subir una foto desde **Ejemplos**, el panel la genera y la sube junto con
ella. Para las fotos que ya estaban, **una vez después de desplegar Vercel**:

1. Abrir el panel desde Chrome, Edge o Firefox (Safari no genera WebP).
2. Tocar **Miniaturas**. Recorre las escenas con fotos, de a tres, y muestra
   el avance en el botón. Al terminar dice cuántas hizo y cuántas fallaron.
3. Si alguna falló, tocarlo de nuevo: salta las que ya tienen.

Las miniaturas quedan en el mismo bucket privado, como `<ruta>.mini.webp`.
No hace falta SQL. Mientras una foto no tiene miniatura, la tarjeta usa la
grande, como antes.

### Probar en local

```bash
node scripts/dev-server.mjs --tier full --admin
```

`--admin` simula el permiso. Los borradores viven en memoria y se pierden al
reiniciar.

## Cambiar prompts

Editando `data/prompts.js` y re-corriendo build + seed. O directamente en la
tabla `prompt_bodies` de Supabase, que no necesita deploy: el catálogo se
cachea hasta 5 minutos para quien no tiene cuenta, los cuerpos no se cachean.

Los centinelas `__N__`, `__N1__`…`__N3__`, `__N_HAIR__`, `__N_FEATURES__` los
reemplaza el navegador. Si editás a mano, respetalos.

## Desarrollo local

```bash
npm run build:catalog
node scripts/dev-server.mjs --tier free      # o premium / full
```

Simula `/api/prompt` con la misma lógica de acceso que producción, sin
necesidad de Supabase. El tier free abre sólo las `GRATIS` de
`api/_access.js`, igual que producción.

## Purgar el historial — ya ejecutado

> Hecho el 15/09/2026. Se conserva por si hiciera falta repetirlo.
>
> El historial anterior tenía los prompts en **43 blobs**: embebidos dentro de
> `index.html` durante ~40 commits, y después en `data/prompts.js`. Se
> reemplazó por un commit único y se borraron las ramas afectadas. Verificado
> con un clon limpio: 0 objetos con el contenido.
>
> Queda pendiente que GitHub corra su recolector, pedido por soporte.

Si alguna vez vuelve a entrar contenido sensible al historial, el
procedimiento es el mismo. Filtrar un solo archivo no alcanza cuando el
contenido estuvo antes en otro: la purga completa es descartar el historial.

```bash
bash scripts/purge-history.sh              # simulacro, no toca nada
bash scripts/purge-history.sh --ejecutar   # hace backup y reescribe en local
```

El script no hace push. Hace un bundle de respaldo, guarda una copia de
`data/prompts.js` fuera del repo, reemplaza el historial por un commit único
sin ese archivo, y verifica que no quede ningún blob con texto de prompt antes
de imprimirte el comando de push. Si la verificación falla, aborta.

**Antes de correrlo:** tener Supabase cargado y la web andando contra la API, y
una copia de `data/prompts.js` fuera del repo. Después de la purga ese archivo
ya no está en git; las copias quedan en tu disco y en Supabase.

**Del lado de GitHub la purga no termina con el push.** Los commits viejos
siguen siendo accesibles por SHA directo hasta que GitHub corra su recolector.
Para que los borre, hay que pedirlo en https://support.github.com. Sin ese
paso el contenido sigue ahí para quien tenga los hashes.
