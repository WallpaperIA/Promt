#!/usr/bin/env bash
#
# Reemplaza el historial del repo por un único commit con el estado actual,
# dejando fuera data/prompts.js.
#
# POR QUÉ ASÍ Y NO FILTRANDO UN ARCHIVO
# Los prompts estuvieron embebidos dentro de index.html durante ~40 commits
# (pesaba 1,1-1,3 MB) antes de moverse a data/prompts.js. Filtrar sólo ese
# archivo dejaría el contenido accesible desde cualquier commit anterior.
# La única purga completa es descartar el historial.
#
# ESTO ES IRREVERSIBLE Y CAMBIA TODOS LOS SHA.
#
# Antes de correrlo:
#   1. Tener Supabase ya cargado (npm run seed) y la web andando contra la API.
#   2. Tener una copia de data/prompts.js fuera del repo. Es tu producto y
#      después de esto no va a estar más en git.
#
# Uso:
#   bash scripts/purge-history.sh            # simulacro, no toca nada
#   bash scripts/purge-history.sh --ejecutar
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EJECUTAR=0
[ "${1:-}" = "--ejecutar" ] && EJECUTAR=1

# Se arma partida a propósito: si la frase apareciera literal, el propio
# script sería un falso positivo en su verificación.
FRASE="visible pores, and subtle"" natural color variation"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="../promt-backup-$STAMP.bundle"
PROMPTS_BACKUP="../prompts.js.backup-$STAMP"

echo "Repo:  $REPO_ROOT"
echo "Rama:  $(git rev-parse --abbrev-ref HEAD)"
echo "Commits actuales: $(git rev-list --all --count)"
echo

# ── Comprobaciones ───────────────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Hay cambios sin commitear. Limpiá el árbol primero."
  exit 1
fi

contar_blobs_con_prompts() {
  local n=0 obj path hits
  while read -r obj path; do
    [ "$(git cat-file -t "$obj" 2>/dev/null)" = "blob" ] || continue
    case "$path" in scripts/purge-history.sh) continue ;; esac
    # grep -c y no -q: con `set -o pipefail`, el corte temprano de `grep -q`
    # le manda SIGPIPE a git cat-file, la tubería devuelve 141 y el resultado
    # se leía como "no encontrado". La verificación daba limpio siempre.
    hits=$(git cat-file -p "$obj" 2>/dev/null | grep -cF "$FRASE" || true)
    if [ "${hits:-0}" -gt 0 ]; then
      n=$((n + 1))
    fi
  done < <(git rev-list --objects --all)
  echo "$n"
}

BLOBS=$(contar_blobs_con_prompts)
echo "Blobs con texto de prompt en el historial: $BLOBS"

if [ "$EJECUTAR" -eq 0 ]; then
  echo
  echo "── SIMULACRO ── no se modificó nada."
  echo "Al ejecutar con --ejecutar:"
  echo "  · backup del repo completo en   $BACKUP"
  echo "  · copia de los prompts en       $PROMPTS_BACKUP"
  echo "  · historial reemplazado por 1 commit sin data/prompts.js"
  echo "  · NO hace push: el comando te lo imprime al final"
  exit 0
fi

# Las ramas del servidor se anotan ahora: más abajo se borran las refs locales
# que las representan, y entonces ya no habría forma de listarlas.
# Se filtra por refname completo: el symref refs/remotes/origin/HEAD tiene
# nombre corto "origin" a secas y se colaba como si fuera una rama.
OTRAS_RAMAS="$(git for-each-ref --format='%(refname)' refs/remotes/origin/ 2>/dev/null \
  | grep -v '^refs/remotes/origin/HEAD$' \
  | grep -v '^refs/remotes/origin/main$' \
  | sed 's|^refs/remotes/origin/||' || true)"

# ── Backups ──────────────────────────────────────────────────────────
echo
echo "→ Backup del repo completo en $BACKUP"
git bundle create "$BACKUP" --all

if [ -f data/prompts.js ]; then
  echo "→ Copia de data/prompts.js en $PROMPTS_BACKUP"
  cp data/prompts.js "$PROMPTS_BACKUP"
else
  echo "⚠ data/prompts.js no está en el árbol. Asegurate de tener una copia."
fi

# ── Sacar los prompts del control de versiones ───────────────────────
if git ls-files --error-unmatch data/prompts.js >/dev/null 2>&1; then
  git rm -q --cached data/prompts.js
fi
if ! grep -q '^data/prompts\.js$' .gitignore 2>/dev/null; then
  printf '\n# Fuente de los prompts: local y en Supabase, nunca en un repo público.\ndata/prompts.js\n' >> .gitignore
fi

# ── Historial nuevo ──────────────────────────────────────────────────
RAMA="$(git rev-parse --abbrev-ref HEAD)"
echo "→ Creando historial nuevo sobre la rama $RAMA"
git checkout -q --orphan _historia_nueva
git add -A
git commit -q -m "Wallpaperia — generador de prompts

Historial reiniciado: los commits anteriores contenían el catálogo completo
de prompts, primero embebido en index.html y después en data/prompts.js.
Los prompts ahora viven en Supabase y se sirven por /api/prompt según el
tier del usuario."

git branch -qD "$RAMA" 2>/dev/null || true
git branch -qm "$RAMA"

# Borrar las demás ramas locales y soltar los objetos viejos
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/ | grep -v "^$RAMA$"); do
  git branch -qD "$b" || true
done

# Las refs de seguimiento remoto y los tags siguen apuntando al historial
# viejo, así que lo mantienen vivo en local. Se borran las refs, no el remoto:
# la URL queda configurada para poder hacer el push.
git for-each-ref --format='%(refname)' refs/remotes/ | while read -r ref; do
  git update-ref -d "$ref"
done
git for-each-ref --format='%(refname)' refs/tags/ | while read -r ref; do
  git update-ref -d "$ref"
done

git reflog expire --expire=now --all
git gc -q --prune=now

# ── Verificación ─────────────────────────────────────────────────────
RESTANTES=$(contar_blobs_con_prompts)

echo
echo "── Resultado ──"
echo "commits:  $(git rev-list --all --count)"
echo "blobs con texto de prompt:  $RESTANTES  (antes: $BLOBS)"
if [ "$RESTANTES" -ne 0 ]; then
  echo "✗ Todavía queda contenido. NO hagas push. Restaurá con:"
  echo "   git clone $BACKUP repo-restaurado"
  exit 1
fi

cat <<EOF

✓ Historial limpio en local. Todavía NO se subió nada.

Para publicarlo:

   git push --force origin $RAMA:main

IMPORTANTE — el force-push reescribe SÓLO main. Las demás ramas del servidor
siguen conteniendo los prompts, así que hay que borrarlas o la purga no sirve:

$(if [ -n "$OTRAS_RAMAS" ]; then echo "$OTRAS_RAMAS" | sed 's|^|   git push origin --delete |'; else echo "   (no se detectaron otras ramas)"; fi)

Y por último, los commits viejos siguen siendo accesibles por su hash directo
hasta que GitHub corra su recolector. Para que los borre, abrí un ticket en
https://support.github.com pidiendo el GC del repositorio. Sin ese paso la
purga no está completa del lado de GitHub.

Restaurar todo si algo salió mal:
   git clone $BACKUP repo-restaurado
EOF
