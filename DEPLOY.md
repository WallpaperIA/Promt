# Despliegue

El sitio es estático (GitHub Pages) y el gating vive en funciones serverless
(Vercel) contra Supabase. Los prompts ya no viajan en el bundle.

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
| `PATREON_WEBHOOK_SECRET` | `webhooks/patreon` | El secreto que muestra Patreon al crear el webhook. Sin esto el webhook rechaza todo, para que nadie pueda cambiar tiers con un POST. |

## Puesta en marcha

1. **Esquema.** Pegar `supabase/schema.sql` en el SQL Editor de Supabase. Es
   idempotente. Verificar después que RLS quedó activo en `categories`,
   `prompt_bodies` y `free_usage`: sin eso, la anon key alcanza para leer
   todos los prompts.

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

5. **Desplegar** Vercel (funciones) y hacer merge a `main` (Pages).

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

### Probar en local

```bash
node scripts/dev-server.mjs --tier full --admin
```

`--admin` simula el permiso. Los borradores viven en memoria y se pierden al
reiniciar.

## Cambiar prompts

Editando `data/prompts.js` y re-corriendo build + seed. O directamente en la
tabla `prompt_bodies` de Supabase, que no necesita deploy: el endpoint cachea
el catálogo 5 minutos, los cuerpos no se cachean.

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

## Activar la organización de Mis versiones

Ejecutar primero `supabase/mis-versiones.sql` si falta la tabla. Luego correr
`supabase/organizar-versiones.sql` antes de desplegar Vercel y Pages. Agrega
carpetas y etiquetas con valores vacíos para las copias existentes; conserva
RLS sin políticas y acceso sólo con service_role. Se puede ejecutar otra vez.

Probar guardar una copia en una carpeta con etiquetas, volver a abrir la
biblioteca y filtrar. Con más de 50 copias, buscar una de la segunda página:
debe encontrarla sin abrir su cuerpo. Otra cuenta no debe ver ninguna
carpeta, etiqueta o título. Una pestaña anterior puede editar el texto sin
borrar los campos nuevos; sigue usando la revisión para evitar conflictos.
Sin ejecutar la migración, la API informa biblioteca no disponible.
