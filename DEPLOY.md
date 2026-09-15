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
| `USAGE_SALT` | `prompt` | Cadena aleatoria larga. Sin esto la función devuelve 500 a propósito: los buckets de cupo serían predecibles. |
| `PATREON_WEBHOOK_SECRET` | `webhooks/patreon` | El secreto que muestra Patreon al crear el webhook. Sin esto el webhook rechaza todo, para que nadie pueda cambiar tiers con un POST. |

Generar el salt:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

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
| $10 o más | `full` |
| $7 a $9,99 | `premium` |
| menos de $7 | `free` |

Antes era un mapa exacto de $7 y $10: cualquier otro monto quedaba como
`free`, así que los que aportaban de más eran los que menos recibían.

Si cambiás los precios en Patreon, actualizá `UMBRALES` en ese archivo.

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
necesidad de Supabase. El cupo free se lleva en memoria.

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
