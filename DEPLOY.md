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
   update users set tier = 'full' where email = 'tu@email.com';
   ```
   Reemplaza a la backdoor `?admin=` y a los códigos, que se eliminaron porque
   sus secretos viajaban en el fuente público.

5. **Desplegar** Vercel (funciones) y hacer merge a `main` (Pages).

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

## Purgar el historial

El repositorio es **público** y los prompts están en su historial: primero
embebidos dentro de `index.html` (pesaba 1,1-1,3 MB durante ~40 commits) y
después en `data/prompts.js`. Son **41 blobs** con el texto completo.

Por eso filtrar sólo `data/prompts.js` no sirve: el contenido se recupera de
cualquier commit anterior. La única purga completa es descartar el historial.

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
